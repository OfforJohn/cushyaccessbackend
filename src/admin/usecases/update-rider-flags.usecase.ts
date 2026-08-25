import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Rider, RiderStatus } from 'src/riders/model/rider.entity';
import { RiderDocument } from 'src/riders/model/rider-document.entity';
import { StandardResponse } from 'src/common/module/standard-response';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { reconcileRiderClearance } from '../../riders/rider-clearance';
import { lockRiderDocumentMutation } from '../../riders/rider-document-lock';
import { EventBus } from '@nestjs/cqrs';
import { Users } from '../../users/model/users.entity';
import { MailSenderService } from '../../user-otp/mail-sender.service';
import { PushNotificationEvent } from '../../users/events/push-notification.event';
import { NotificationCategory } from '../../users/model/notification-category';

export class UpdateRiderFlagsDto {
  @IsOptional()
  @IsBoolean()
  trainingCompleted?: boolean;

  @IsOptional()
  @IsIn(['approved', 'pending', 'rejected'])
  backgroundCheckStatus?: 'approved' | 'pending' | 'rejected';
}

@Injectable()
export class UpdateRiderFlagsUseCase {
  private readonly logger = new Logger(UpdateRiderFlagsUseCase.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly eventBus: EventBus,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly mailSenderService: MailSenderService,
  ) {}

  async execute(
    riderId: string,
    flags: UpdateRiderFlagsDto,
  ): Promise<StandardResponse> {
    if (
      flags.trainingCompleted === undefined &&
      flags.backgroundCheckStatus === undefined
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'NO_RIDER_FLAGS_PROVIDED'),
      );
    }
    const result = await this.dataSource.transaction(async (manager) => {
      await lockRiderDocumentMutation(manager, riderId);
      const lockedRider = await manager.findOne(Rider, {
        where: { id: riderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedRider) {
        throw new NotFoundException(
          new StandardResponse(true, 'RIDER_NOT_FOUND'),
        );
      }
      const previous = {
        status: lockedRider.status,
        trainingCompleted: Boolean(lockedRider.trainingCompleted),
        backgroundCheckStatus: lockedRider.backgroundCheckStatus,
      };
      if (flags.trainingCompleted !== undefined) {
        lockedRider.trainingCompleted = flags.trainingCompleted;
        lockedRider.trainingCompletedAt = flags.trainingCompleted
          ? lockedRider.trainingCompletedAt || new Date()
          : null;
      }
      if (flags.backgroundCheckStatus !== undefined) {
        lockedRider.backgroundCheckStatus = flags.backgroundCheckStatus;
        lockedRider.backgroundCheckCompletedAt =
          flags.backgroundCheckStatus === 'approved'
            ? lockedRider.backgroundCheckCompletedAt || new Date()
            : null;
      }
      const documents = await manager.find(RiderDocument, {
        where: { riderId: lockedRider.id },
      });
      reconcileRiderClearance(lockedRider, documents);
      await manager.save(Rider, lockedRider);
      return { rider: lockedRider, previous };
    });

    const notification = this.getNotification(result.rider, result.previous);
    if (notification) {
      try {
        this.eventBus.publish(
          new PushNotificationEvent(
            result.rider.userId,
            notification.category,
            notification.message,
          ),
        );
      } catch (error) {
        this.logger.warn(
          `Rider ${riderId} clearance changed, but its notification could not be queued: ${error?.message || error}`,
        );
      }

      try {
        const user = await this.usersRepository.findOne({
          where: { id: result.rider.userId },
          select: { id: true, firstName: true, lastName: true, email: true },
        });
        if (user?.email) {
          const emailResult = await this.mailSenderService.sendMail({
            recipient: user.email,
            subject: notification.subject,
            template: 'rider-status',
            content: {
              riderName:
                `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
                'Rider',
              heading: notification.heading,
              message: notification.message,
              nextStep: notification.nextStep,
              status: result.rider.status,
              updateDate: new Date().toLocaleDateString('en-NG'),
            },
          });
          if (!emailResult) {
            this.logger.warn(
              `Rider ${riderId} clearance changed, but its email could not be sent`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `Rider ${riderId} clearance changed, but its email could not be prepared: ${error?.message || error}`,
        );
      }
    }

    return new StandardResponse(false, 'RIDER_FLAGS_UPDATED', {
      riderId: result.rider.id,
      trainingCompleted: Boolean(result.rider.trainingCompleted),
      backgroundCheckStatus: result.rider.backgroundCheckStatus,
      status: result.rider.status,
    });
  }

  private getNotification(
    rider: Rider,
    previous: {
      status: RiderStatus;
      trainingCompleted: boolean;
      backgroundCheckStatus: string | null;
    },
  ): {
    category: NotificationCategory;
    heading: string;
    subject: string;
    message: string;
    nextStep: string;
  } | null {
    if (
      rider.status === RiderStatus.ACTIVE &&
      previous.status !== RiderStatus.ACTIVE
    ) {
      return {
        category: NotificationCategory.RIDER_STATUS_CHANGED,
        heading: 'Your rider account is active',
        subject: 'You are approved to deliver with Cushy Access',
        message:
          'Your verification is complete and your rider account is now active.',
        nextStep: 'Open the rider app and go online when you are ready.',
      };
    }
    if (
      rider.backgroundCheckStatus !== previous.backgroundCheckStatus &&
      rider.backgroundCheckStatus === 'rejected'
    ) {
      return {
        category: NotificationCategory.RIDER_BACKGROUND_CHECK_REJECTED,
        heading: 'Background check needs attention',
        subject: 'Update regarding your Cushy Access background check',
        message:
          'Your background check could not be approved. Contact support for the reason and next steps.',
        nextStep: 'Open the rider app and use the support option.',
      };
    }
    if (
      rider.backgroundCheckStatus !== previous.backgroundCheckStatus &&
      rider.backgroundCheckStatus === 'approved'
    ) {
      return {
        category: NotificationCategory.RIDER_BACKGROUND_CHECK_APPROVED,
        heading: 'Background check approved',
        subject: 'Your Cushy Access background check was approved',
        message:
          'Your background check has been approved. Your rider verification has moved to the next stage.',
        nextStep: 'Open the rider app to see your current verification stage.',
      };
    }
    if (rider.trainingCompleted && !previous.trainingCompleted) {
      return {
        category: NotificationCategory.RIDER_TRAINING_COMPLETED,
        heading: 'Training completed',
        subject: 'Your Cushy Access rider training is complete',
        message: 'Your rider training has been marked as completed.',
        nextStep: 'Open the rider app to see your current account status.',
      };
    }
    return null;
  }
}

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { CommonService } from 'src/common/common.service';
import { StandardResponse } from 'src/common/module/standard-response';
import { Rider, RiderStatus } from 'src/riders/model/rider.entity';
import {
  DocumentStatus,
  RiderDocument,
} from 'src/riders/model/rider-document.entity';
import { PushNotificationEvent } from 'src/users/events/push-notification.event';
import { NotificationCategory } from 'src/users/model/notification-category';
import { reconcileRiderClearance } from '../../riders/rider-clearance';
import { lockRiderDocumentMutation } from '../../riders/rider-document-lock';
import { Users } from '../../users/model/users.entity';
import { MailSenderService } from '../../user-otp/mail-sender.service';

export class ReviewRiderDocumentDto {
  @IsIn([DocumentStatus.VERIFIED, DocumentStatus.REJECTED])
  status: DocumentStatus.VERIFIED | DocumentStatus.REJECTED;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

@Injectable()
export class ReviewRiderDocumentUseCase {
  private readonly logger = new Logger(ReviewRiderDocumentUseCase.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly commonService: CommonService,
    private readonly eventBus: EventBus,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly mailSenderService: MailSenderService,
  ) {}

  async execute(
    riderId: string,
    documentId: string,
    dto: ReviewRiderDocumentDto,
  ): Promise<StandardResponse> {
    const admin = await this.commonService.getLoggedInUser();
    if (dto.status === DocumentStatus.REJECTED && !dto.notes?.trim()) {
      throw new BadRequestException(
        new StandardResponse(true, 'DOCUMENT_REJECTION_NOTE_REQUIRED'),
      );
    }
    const result = await this.dataSource.transaction(async (manager) => {
      await lockRiderDocumentMutation(manager, riderId);
      const rider = await manager.findOne(Rider, {
        where: { id: riderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!rider) {
        throw new NotFoundException(
          new StandardResponse(true, 'RIDER_NOT_FOUND'),
        );
      }
      const document = await manager.findOne(RiderDocument, {
        where: { id: documentId, riderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!document) {
        throw new NotFoundException(
          new StandardResponse(true, 'RIDER_DOCUMENT_NOT_FOUND'),
        );
      }

      const normalizedNotes = dto.notes?.trim() || null;
      const previousRiderStatus = rider.status;
      const changed =
        document.status !== dto.status ||
        (document.verificationNotes || null) !== normalizedNotes;
      if (!changed) {
        return { document, rider, previousRiderStatus, changed: false };
      }
      document.status = dto.status;
      document.verificationNotes = normalizedNotes;
      document.verifiedBy = admin.id;
      document.verifiedAt =
        dto.status === DocumentStatus.VERIFIED ? new Date() : null;
      await manager.save(RiderDocument, document);

      const documents = await manager.find(RiderDocument, {
        where: { riderId },
      });
      reconcileRiderClearance(rider, documents);
      await manager.save(Rider, rider);

      return { document, rider, previousRiderStatus, changed: true };
    });

    if (result.changed) {
      const documentName = this.getDocumentName(result.document.documentType);
      const riderWasActivated =
        result.rider.status === RiderStatus.ACTIVE &&
        result.previousRiderStatus !== RiderStatus.ACTIVE;
      const notificationMessage = riderWasActivated
        ? `Your ${documentName} has been verified. Your rider account is now active.`
        : dto.status === DocumentStatus.VERIFIED
          ? `Your ${documentName} has been verified.`
          : `Your ${documentName} was rejected.${result.document.verificationNotes ? ` Reason: ${result.document.verificationNotes}` : ''} Open the rider app to upload a replacement.`;
      try {
        this.eventBus.publish(
          new PushNotificationEvent(
            result.rider.userId,
            riderWasActivated
              ? NotificationCategory.RIDER_STATUS_CHANGED
              : dto.status === DocumentStatus.VERIFIED
                ? NotificationCategory.RIDER_DOCUMENT_VERIFIED
                : NotificationCategory.RIDER_DOCUMENT_REJECTED,
            notificationMessage,
          ),
        );
      } catch (error) {
        this.logger.warn(
          `Document ${documentId} was reviewed, but its notification could not be queued: ${error?.message || error}`,
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
            subject: riderWasActivated
              ? 'You are approved to deliver with Cushy Access'
              : dto.status === DocumentStatus.VERIFIED
                ? `${documentName} approved - Cushy Access Rider`
                : `Action required: ${documentName} needs to be replaced`,
            template: 'rider-verification',
            content: {
              riderName:
                `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
                'Rider',
              status: dto.status.toUpperCase(),
              documentName,
              rejectionReason: result.document.verificationNotes,
              riderStatus: result.rider.status,
              reviewDate: new Date().toLocaleDateString('en-NG'),
            },
          });
          if (!emailResult) {
            this.logger.warn(
              `Document ${documentId} was reviewed, but its email could not be sent`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `Document ${documentId} was reviewed, but its email could not be prepared: ${error?.message || error}`,
        );
      }
    }

    return new StandardResponse(false, 'RIDER_DOCUMENT_REVIEWED', {
      id: result.document.id,
      riderId,
      type: result.document.documentType,
      status: result.document.status,
      verificationNotes: result.document.verificationNotes,
      verifiedBy: result.document.verifiedBy,
      verifiedAt: result.document.verifiedAt,
      riderStatus: result.rider.status,
      changed: result.changed,
    });
  }

  private getDocumentName(documentType: string): string {
    if (documentType === 'id_card') return 'NIN slip';
    if (documentType === 'driving_license') return "rider's permit";
    if (documentType === 'bike_registration') return 'bike registration';
    return documentType.replace(/_/g, ' ');
  }
}

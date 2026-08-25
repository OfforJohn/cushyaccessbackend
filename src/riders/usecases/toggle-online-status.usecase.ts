import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rider, RiderStatus } from '../model/rider.entity';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { EventBus } from '@nestjs/cqrs';
import { PushNotificationEvent } from 'src/users/events/push-notification.event';
import { NotificationCategory } from 'src/users/model/notification-category';

@Injectable()
export class ToggleOnlineStatusUseCase {
  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    private readonly commonService: CommonService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(riderId: string, goOnline: boolean): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    if (authenticatedUser.id !== riderId) {
      throw new BadRequestException(
        new StandardResponse(true, 'RIDER_NOT_FOUND_OR_UNAUTHORIZED'),
      );
    }

    const rider = await this.riderRepository.findOne({
      where: { userId: authenticatedUser.id },
    });

    if (!rider) {
      throw new BadRequestException(
        new StandardResponse(true, 'RIDER_NOT_FOUND_OR_UNAUTHORIZED'),
      );
    }

    if (goOnline) {
      if (rider.status !== RiderStatus.ACTIVE) {
        throw new BadRequestException(
          new StandardResponse(true, 'RIDER_NOT_ACTIVE'),
        );
      }
      if (!rider.trainingCompleted) {
        throw new BadRequestException(
          new StandardResponse(true, 'TRAINING_NOT_COMPLETED'),
        );
      }
      if (rider.backgroundCheckStatus !== 'approved') {
        throw new BadRequestException(
          new StandardResponse(true, 'BACKGROUND_CHECK_NOT_APPROVED'),
        );
      }
    }

    rider.isOnline = goOnline;
    await this.riderRepository.save(rider);

    this.eventBus.publish(
        new PushNotificationEvent(
            rider.userId,
            NotificationCategory.RIDER_ONLINE_STATUS_CHANGED,
            `Your online status has been updated.`,
        ),
    );

    return new StandardResponse(
      false,
      goOnline ? 'RIDER_IS_NOW_ONLINE' : 'RIDER_IS_NOW_OFFLINE',
    );
  }
}

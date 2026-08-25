import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rider, PayoutSchedule } from '../model/rider.entity';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { IsEnum } from 'class-validator';

export class UpdatePayoutScheduleDto {
  @IsEnum(PayoutSchedule, { message: 'Schedule must be: daily, weekly, monthly, or manual' })
  schedule: PayoutSchedule;
}

@Injectable()
export class UpdateRiderPayoutScheduleUseCase {
  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    private readonly commonService: CommonService,
  ) {}

  async execute(dto: UpdatePayoutScheduleDto): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    
    const rider = await this.riderRepository.findOne({
      where: { userId: authenticatedUser.id },
    });

    if (!rider) {
      throw new NotFoundException(
        new StandardResponse(true, 'RIDER_NOT_FOUND'),
      );
    }

    rider.payoutSchedule = dto.schedule;
    await this.riderRepository.save(rider);

    return new StandardResponse(
      false,
      'RIDER_PAYOUT_SCHEDULE_UPDATED',
      {
        payoutSchedule: rider.payoutSchedule,
      },
    );
  }
}

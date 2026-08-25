import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rider } from '../model/rider.entity';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';

@Injectable()
export class GetRiderPayoutDetailsUseCase {
  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    private readonly commonService: CommonService,
  ) {}

  async execute(): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    
    const rider = await this.riderRepository.findOne({
      where: { userId: authenticatedUser.id },
    });

    if (!rider) {
      throw new NotFoundException(
        new StandardResponse(true, 'RIDER_NOT_FOUND'),
      );
    }

    return new StandardResponse(
      false,
      'RIDER_PAYOUT_DETAILS_FETCHED',
      {
        bankName: rider.bankName,
        accountNumber: rider.accountNumber,
        accountName: rider.accountHolderName,
        bankCode: rider.bankCode,
        isVerified: rider.bankDetailsVerified,
      },
    );
  }
}

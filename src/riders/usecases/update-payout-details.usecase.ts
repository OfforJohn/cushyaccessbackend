import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rider } from '../model/rider.entity';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { IsString, IsNotEmpty, Matches, MaxLength } from 'class-validator';
import { PaystackService } from '../../wallet/services/paystack.service';

export class UpdateRiderPayoutDetailsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  bankName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10}$/)
  accountNumber: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  accountHolderName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2,10}$/)
  bankCode: string;
}

@Injectable()
export class UpdateRiderPayoutDetailsUseCase {
  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    private readonly commonService: CommonService,
    private readonly paystackService: PaystackService,
  ) {}

  async execute(dto: UpdateRiderPayoutDetailsDto): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    
    const rider = await this.riderRepository.findOne({
      where: { userId: authenticatedUser.id },
    });

    if (!rider) {
      throw new NotFoundException(
        new StandardResponse(true, 'RIDER_NOT_FOUND'),
      );
    }

    const enquiry = await this.paystackService.resolveBankAccount(
      dto.accountNumber,
      dto.bankCode,
    );
    const verifiedAccountName = enquiry?.account_name;
    if (!verifiedAccountName) {
      throw new BadRequestException(
        new StandardResponse(true, 'BANK_ACCOUNT_VERIFICATION_FAILED'),
      );
    }

    const accountChanged =
      rider.accountNumber !== dto.accountNumber || rider.bankCode !== dto.bankCode;
    rider.bankName = dto.bankName.trim();
    rider.accountNumber = dto.accountNumber;
    rider.accountHolderName = String(verifiedAccountName).trim();
    rider.bankCode = dto.bankCode;
    rider.bankDetailsVerified = true;
    if (accountChanged) rider.recipientCode = null;

    await this.riderRepository.save(rider);

    return new StandardResponse(
      false,
      'RIDER_PAYOUT_DETAILS_UPDATED',
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

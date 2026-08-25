import { Between, In, Repository } from 'typeorm';
import { StandardResponse } from '../../common/module/standard-response';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from 'src/users/model/users.entity';
import { UserRoles } from 'src/users/model/user-roles.enum';
import dayjs from 'dayjs';
import { UserCredentialStatus } from 'src/users/model/user-credential.enum';

@Injectable()
export class VendorStatsUseCase {
  constructor(
    @InjectRepository(Users) private userRepository: Repository<Users>,
  ) { }

  async execute(filter?: {
    month?: number;
    year?: number;
  }): Promise<StandardResponse> {
    const now = dayjs();
    const isValidNumber = (value: any): value is number =>
      typeof value === 'number' && !isNaN(value);

    const selectedMonth = isValidNumber(filter?.month)
      ? filter!.month
      : now.month() + 1;
    const selectedYear = isValidNumber(filter?.year)
      ? filter!.year
      : now.year();

    const paddedMonth = String(selectedMonth).padStart(2, '0');

    const startOfMonth = dayjs(`${selectedYear}-${paddedMonth}-01`)
      .startOf('month')
      .toDate();
    const endOfMonth = dayjs(startOfMonth).endOf('month').toDate();

    // Get orders in the date range and with desired statuses
    const totalVendors = await this.userRepository.count({
      where: {
        userRole: In([UserRoles.VENDOR]),
        createdAt: Between(startOfMonth, endOfMonth),
      },
    });

    const newVendors = await this.userRepository.count({
      where: {
        userRole: In([UserRoles.VENDOR]),
        createdAt: Between(startOfMonth, endOfMonth),
      },
    });

    const verifiedVendors = await this.userRepository.count({
      where: {
        userRole: In([UserRoles.VENDOR]),
        isVerified: true,
      }
    });

    // Count vendors explicitly rejected by admin
    const rejectedVendors = await this.userRepository.count({
      where: {
        userRole: In([UserRoles.VENDOR]),
        verificationStatus: UserCredentialStatus.REJECTED,
      },
    });

    const unverifiedVendors = totalVendors - verifiedVendors;
    return new StandardResponse(false, 'VENDOR_STATS_FETCHED_SUCCESSFULLY', {
      totalVendors,
      newVendors,
      verifiedVendors,
      unverifiedVendors,
      rejectedVendors, // Count of vendors explicitly rejected by admin
    });
  }
}

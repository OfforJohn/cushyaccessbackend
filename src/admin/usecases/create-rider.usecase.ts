import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { StandardResponse } from '../../common/module/standard-response';
import { Rider, RiderStatus } from '../../riders/model/rider.entity';
import { UserRoles } from '../../users/model/user-roles.enum';
import { Users } from '../../users/model/users.entity';
import {
  getCanonicalPhoneIdentity,
  getNormalizedCountryCallingCode,
  getPhoneCandidates,
  normalizeStoredPhone,
} from '../../users/services/user-identifier';
import { Wallets } from '../../wallet/model/wallet.entity';
import { CreateRiderDto } from '../dto/create-rider.dto';

@Injectable()
export class CreateRiderUseCase {
  constructor(private readonly dataSource: DataSource) {}

  async execute(dto: CreateRiderDto) {
    const email = dto.email.trim().toLowerCase();
    const countryCode = dto.countryCode.trim().toUpperCase();
    const callingCode =
      getNormalizedCountryCallingCode(countryCode) ||
      dto.callingCode.replace(/\D/g, '');
    const mobile = normalizeStoredPhone(dto.mobile, callingCode, countryCode);
    const canonicalPhone = getCanonicalPhoneIdentity(
      mobile,
      callingCode,
      countryCode,
    );
    const phoneCandidates = getPhoneCandidates(
      mobile,
      callingCode,
      countryCode,
    );

    const result = await this.dataSource.transaction(async (manager) => {
      // Lock email and every equivalent phone representation independently.
      // A combined email|phone key would still allow two concurrent requests
      // with the same email and different phone numbers (or vice versa) to
      // pass the existence check. Sorting prevents lock-order deadlocks.
      const identityLocks = [
        `user-email:${email}`,
        `user-phone:${canonicalPhone}`,
      ]
        .filter((value, index, values) => values.indexOf(value) === index)
        .sort();
      for (const identityLock of identityLocks) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          identityLock,
        ]);
      }
      const existingUsers = await manager.find(Users, {
        where: [{ email }, { mobile: In(phoneCandidates) }],
      });
      if (existingUsers.some((user) => user.email.toLowerCase() === email)) {
        throw new BadRequestException(
          new StandardResponse(true, 'EXISTING_USER_WITH_EMAIL'),
        );
      }
      if (
        existingUsers.some(
          (user) =>
            getCanonicalPhoneIdentity(
              user.mobile,
              user.callingCode || '234',
              user.countryCode || 'NG',
            ) === canonicalPhone,
        )
      ) {
        throw new BadRequestException(
          new StandardResponse(true, 'EXISTING_USER_WITH_MOBILE'),
        );
      }

      const user = manager.create(Users, {
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        email,
        mobile,
        callingCode,
        countryCode,
        dateOfBirth: dto.dateOfBirth || null,
        password: await bcrypt.hash(dto.password, 12),
        userRole: UserRoles.RIDER,
        completedOnboarding: false,
        isVerified: false,
      });
      await manager.save(Users, user);

      const rider = manager.create(Rider, {
        userId: user.id,
        status: RiderStatus.PENDING,
        isOnline: false,
        rating: 0,
        totalDeliveries: 0,
        totalEarnings: 0,
        acceptanceRate: 0,
        completionRate: 0,
        onlineHours: 0,
        trainingCompleted: false,
        backgroundCheckStatus: 'pending',
        bankDetailsVerified: false,
        bikeType: dto.bikeType || null,
        bikeBrand: dto.bikeBrand?.trim() || null,
        bikeModel: dto.bikeModel?.trim() || null,
        bikeColor: dto.bikeColor?.trim() || null,
        licensePlate: dto.licensePlate?.trim().toUpperCase() || null,
      });
      await manager.save(Rider, rider);

      const wallet = manager.create(Wallets, {
        userId: user.id,
        walletBalance: 0,
        hasSetPin: false,
      });
      await manager.save(Wallets, wallet);

      return {
        userId: user.id,
        riderId: rider.id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        phone: user.mobile,
        status: rider.status,
        requiresPhoneVerification: true,
        requiresDocumentVerification: true,
      };
    });

    return new StandardResponse(false, 'RIDER_CREATED', result);
  }
}

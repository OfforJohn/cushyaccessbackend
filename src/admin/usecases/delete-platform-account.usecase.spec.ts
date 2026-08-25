import { BadRequestException } from '@nestjs/common';
import { DeletePlatformAccountUseCase } from './delete-platform-account.usecase';
import { Users } from 'src/users/model/users.entity';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { UserLocations } from 'src/users/model/user-locations.entity';
import { Rider } from 'src/riders/model/rider.entity';
import { RiderDocument } from 'src/riders/model/rider-document.entity';
import { Wallets } from 'src/wallet/model/wallet.entity';
import { Stores } from 'src/stores/model/stores.entity';
import { MenuItem } from 'src/stores/model/menu-item.entity';
import { OpeningSchedule } from 'src/stores/model/opening-schedule.entity';
import { ProfessionDetails } from 'src/doctor/models/professional-details.entity';
import { DoctorSignature } from 'src/doctor/models/doctor-signature.entity';
import { Prescription } from 'src/doctor/models/prescription.entity';
import { UserOtp } from 'src/user-otp/model/user-otp.entity';
import { ApiKeys } from 'src/api-keys/api-keys.entity';

describe('DeletePlatformAccountUseCase', () => {
  const build = (user: Partial<Users>) => {
    const rider = {
      id: 'rider_1',
      userId: user.id,
      profilePhoto: 'rider-photo',
    };
    const queryBuilder = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === Users) return user;
        if (entity === Rider && user.userRole === UserRoles.RIDER) return rider;
        return null;
      }),
      find: jest.fn(async (entity: unknown) => {
        if (entity === UserLocations) return [];
        if (entity === RiderDocument) {
          return [{ id: 'doc_1', documentUrl: 'document-photo' }];
        }
        if (entity === Stores && user.userRole === UserRoles.VENDOR) {
          return [{ id: 'store_1', userId: user.id }];
        }
        if (entity === MenuItem || entity === OpeningSchedule) return [];
        if (entity === DoctorSignature) return [];
        return [];
      }),
      delete: jest.fn(async (entity: unknown) => ({
        affected: entity === Users ? 1 : 0,
      })),
      createQueryBuilder: jest.fn(() => queryBuilder),
      count: jest.fn().mockResolvedValue(0),
      getRepository: jest.fn((entity: unknown) => ({
        createQueryBuilder: () => {
          if (entity !== Prescription) return queryBuilder;
          return {
            where: jest.fn().mockReturnThis(),
            orWhere: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockResolvedValue([]),
          };
        },
      })),
    };
    const dataSource = {
      transaction: jest.fn(
        async (callback: (value: typeof manager) => unknown) =>
          callback(manager),
      ),
    };
    const s3 = { deleteFileByUrl: jest.fn().mockResolvedValue(undefined) };
    const usersService = {
      invalidateUserCaches: jest.fn().mockResolvedValue(undefined),
    };
    const useCase = new DeletePlatformAccountUseCase(
      dataSource as never,
      s3 as never,
      usersService as never,
    );
    return { useCase, manager, s3, usersService };
  };

  it('requires an exact account-email confirmation before deleting anything', async () => {
    const { useCase, manager } = build({
      id: 'user_1',
      email: 'rider@example.com',
      userRole: UserRoles.RIDER,
    });

    await expect(
      useCase.execute('user_1', 'wrong@example.com'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('refuses administrative accounts', async () => {
    const { useCase, manager } = build({
      id: 'user_1',
      email: 'admin@example.com',
      userRole: UserRoles.ADMIN,
    });

    await expect(
      useCase.execute('user_1', 'admin@example.com'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('permanently deletes a customer and their authentication record', async () => {
    const { useCase, manager } = build({
      id: 'customer_1',
      email: 'customer@example.com',
      userRole: UserRoles.CUSTOMER,
    });

    const response = await useCase.execute(
      'customer_1',
      'customer@example.com',
    );

    expect(manager.delete).toHaveBeenCalledWith(Wallets, {
      userId: 'customer_1',
    });
    expect(manager.delete).toHaveBeenCalledWith(UserOtp, {
      userId: 'customer_1',
    });
    expect(manager.delete).toHaveBeenCalledWith(ApiKeys, {
      userId: 'customer_1',
    });
    expect(manager.delete).toHaveBeenCalledWith(Users, {
      id: 'customer_1',
    });
    expect(response.toJSON().data).toEqual(
      expect.objectContaining({ databaseDeleted: true }),
    );
  });

  it('deletes rider data and wallet in one database transaction before storage cleanup', async () => {
    const { useCase, manager, s3, usersService } = build({
      id: 'user_1',
      email: 'rider@example.com',
      userRole: UserRoles.RIDER,
      profilePic: 'user-photo',
    });

    const response = await useCase.execute('user_1', ' RIDER@example.com ');

    expect(manager.delete).toHaveBeenCalledWith(Rider, { id: 'rider_1' });
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['rider-documents:rider_1'],
    );
    expect(manager.delete).toHaveBeenCalledWith(Wallets, { userId: 'user_1' });
    expect(manager.delete).toHaveBeenCalledWith(Users, { id: 'user_1' });
    expect(usersService.invalidateUserCaches).toHaveBeenCalled();
    expect(s3.deleteFileByUrl).toHaveBeenCalledTimes(3);
    expect(response.toJSON().data).toEqual(
      expect.objectContaining({
        databaseDeleted: true,
        storageCleanupFailures: 0,
      }),
    );
  });

  it('retries failed storage cleanup and reports only persistent failures', async () => {
    const { useCase, s3 } = build({
      id: 'user_1',
      email: 'rider@example.com',
      userRole: UserRoles.RIDER,
      profilePic: 'user-photo',
    });
    s3.deleteFileByUrl.mockRejectedValueOnce(new Error('temporary failure'));

    const response = await useCase.execute('user_1', 'rider@example.com');

    expect(s3.deleteFileByUrl).toHaveBeenCalledTimes(4);
    expect((response.toJSON().data as any).storageCleanupFailures).toBe(0);
  });

  it('deletes a merchant store graph and its wallet', async () => {
    const { useCase, manager } = build({
      id: 'vendor_1',
      email: 'merchant@example.com',
      userRole: UserRoles.VENDOR,
    });

    await useCase.execute('vendor_1', 'merchant@example.com');

    expect(manager.delete).toHaveBeenCalledWith(Stores, { userId: 'vendor_1' });
    expect(manager.delete).toHaveBeenCalledWith(Wallets, {
      userId: 'vendor_1',
    });
    expect(manager.delete).toHaveBeenCalledWith(Users, { id: 'vendor_1' });
  });

  it('deletes a health professional clinical graph and wallet', async () => {
    const { useCase, manager } = build({
      id: 'doctor_1',
      email: 'doctor@example.com',
      userRole: UserRoles.DOCTOR,
    });

    await useCase.execute('doctor_1', 'doctor@example.com');

    expect(manager.delete).toHaveBeenCalledWith(ProfessionDetails, {
      userId: 'doctor_1',
    });
    expect(manager.delete).toHaveBeenCalledWith(Wallets, {
      userId: 'doctor_1',
    });
    expect(manager.delete).toHaveBeenCalledWith(Users, { id: 'doctor_1' });
  });
});

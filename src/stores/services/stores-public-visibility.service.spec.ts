import { NotFoundException } from '@nestjs/common';
import { UserCredentialStatus } from '../../users/model/user-credential.enum';
import { StoreService } from './stores.service';

describe('StoreService public store visibility', () => {
  const createService = (result: unknown) => {
    const queryBuilder: any = {
      leftJoinAndSelect: jest.fn(),
      innerJoin: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      getOne: jest.fn().mockResolvedValue(result),
    };
    Object.values(queryBuilder).forEach((method: any) => {
      if (method?.mockReturnValue && method !== queryBuilder.getOne) {
        method.mockReturnValue(queryBuilder);
      }
    });
    const service = Object.create(StoreService.prototype) as any;
    service.storeRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    service.attachOpeningSchedules = jest.fn(async (stores) => stores);
    return { service, queryBuilder };
  };

  it('returns an approved active store without selecting its vendor account', async () => {
    const store = { id: 'store-1', isSuspended: false };
    const { service, queryBuilder } = createService(store);

    await expect(service.getPublicStoreById('store-1')).resolves.toBe(store);

    expect(queryBuilder.innerJoin).toHaveBeenCalledWith('store.user', 'vendor');
    expect(queryBuilder.leftJoinAndSelect).not.toHaveBeenCalledWith(
      'store.user',
      expect.any(String),
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'vendor.verificationStatus = :approvedStatus',
      { approvedStatus: UserCredentialStatus.APPROVED },
    );
  });

  it('does not expose a store that fails public eligibility', async () => {
    const { service } = createService(null);

    await expect(service.getPublicStoreById('hidden-store')).rejects.toThrow(
      NotFoundException,
    );
  });
});

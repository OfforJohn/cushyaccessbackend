import { StoreService } from './stores.service';
import { Stores } from '../model/stores.entity';
import { UserRoles } from '../../users/model/user-roles.enum';
import { NotFoundException } from '@nestjs/common';

describe('StoreService contact uniqueness', () => {
  const store: Partial<Stores> = {
    id: 'str_primary',
    userId: 'usr_merchant',
    email: 'primary@example.com',
    mobile: '08030000000',
  };

  const dto = {
    name: 'Second branch',
    description: 'Another location',
    coverImage: '',
    email: 'second@example.com',
    mobile: '08030000000',
    addressId: 'loc_second',
  };

  const createHarness = ({
    emailUsedByAnotherMerchant = false,
    mobileUsedByAnotherMerchant = false,
    authenticatedUserId = store.userId,
    authenticatedUserRole = UserRoles.VENDOR,
  } = {}) => {
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn(() => storeRepository),
    };
    const storeRepository = {
      findOne: jest.fn().mockResolvedValue({ ...store }),
      exists: jest
        .fn()
        .mockResolvedValueOnce(emailUsedByAnotherMerchant)
        .mockResolvedValueOnce(mobileUsedByAnotherMerchant),
      save: jest.fn(async (value) => value),
      manager: {
        transaction: jest.fn(async (work) => work(manager)),
      },
    };
    const commonService = {
      getLoggedInUser: jest.fn().mockResolvedValue({
        id: authenticatedUserId,
        userRole: authenticatedUserRole,
      }),
    };
    const userLocationsService = {
      getLocationById: jest.fn().mockResolvedValue({ id: dto.addressId }),
    };
    const service = new StoreService(
      storeRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      commonService as any,
      userLocationsService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, storeRepository, manager };
  };

  it('allows a phone number already used by another store under the same merchant', async () => {
    const { service, storeRepository } = createHarness();

    const response = await service.updateStore(store.id!, dto);

    expect(response.toJSON()).toMatchObject({
      error: false,
      message: 'STORE_UPDATED_SUCCESSFULLY',
    });
    expect(storeRepository.save).toHaveBeenCalledTimes(1);

    const mobileLookup = storeRepository.exists.mock.calls[1][0].where;
    expect(mobileLookup.userId).toMatchObject({
      _type: 'not',
      _value: store.userId,
    });
    expect(mobileLookup.mobile).toMatchObject({
      _type: 'raw',
      _objectLiteralParameters: { normalizedMobile: '2348030000000' },
    });
  });

  it('allows an email already used by another store under the same merchant', async () => {
    const { service, storeRepository } = createHarness();

    const response = await service.updateStore(store.id!, dto);

    expect(response.toJSON()).toMatchObject({
      error: false,
      message: 'STORE_UPDATED_SUCCESSFULLY',
    });

    const emailLookup = storeRepository.exists.mock.calls[0][0].where;
    expect(emailLookup.email).toMatchObject({
      _type: 'raw',
      _objectLiteralParameters: { normalizedEmail: dto.email },
    });
    expect(emailLookup.userId).toMatchObject({
      _type: 'not',
      _value: store.userId,
    });
  });

  it('rejects an email used by a different merchant account', async () => {
    const { service, storeRepository } = createHarness({
      emailUsedByAnotherMerchant: true,
    });

    const response = await service.updateStore(store.id!, dto);

    expect(response.toJSON()).toMatchObject({
      error: true,
      message: 'EMAIL_ALREADY_IN_USE',
    });
    expect(storeRepository.exists).toHaveBeenCalledTimes(1);
    expect(storeRepository.save).not.toHaveBeenCalled();
  });

  it('serializes email and phone claims inside the store update transaction', async () => {
    const { service, storeRepository, manager } = createHarness();

    await service.updateStore(store.id!, dto);

    expect(storeRepository.manager.transaction).toHaveBeenCalledTimes(1);
    expect(manager.query.mock.calls).toEqual([
      [
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`store-email:${dto.email}`],
      ],
      [
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        ['store-mobile:2348030000000'],
      ],
    ]);
    expect(storeRepository.findOne).toHaveBeenCalledWith({
      where: { id: store.id },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('normalizes email casing and whitespace before checking and saving', async () => {
    const { service, storeRepository } = createHarness();

    await service.updateStore(store.id!, {
      ...dto,
      email: '  SECOND@EXAMPLE.COM  ',
    });

    const emailLookup = storeRepository.exists.mock.calls[0][0].where;
    expect(emailLookup.email).toMatchObject({
      _objectLiteralParameters: { normalizedEmail: 'second@example.com' },
    });
    expect(storeRepository.save.mock.calls[0][0].email).toBe(
      'second@example.com',
    );
  });

  it('does not allow one merchant to update another merchant account store', async () => {
    const { service, storeRepository } = createHarness({
      authenticatedUserId: 'usr_other',
    });

    await expect(service.updateStore(store.id!, dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storeRepository.exists).not.toHaveBeenCalled();
    expect(storeRepository.save).not.toHaveBeenCalled();
  });

  it('rejects a phone number used by a different merchant account', async () => {
    const { service, storeRepository } = createHarness({
      mobileUsedByAnotherMerchant: true,
    });

    const response = await service.updateStore(store.id!, dto);

    expect(response.toJSON()).toMatchObject({
      error: true,
      message: 'MOBILE_ALREADY_IN_USE',
    });
    expect(storeRepository.save).not.toHaveBeenCalled();
  });
});

import { StoreService } from './stores.service';
import { OtpPurpose } from '../../user-otp/model/otp-purpose.enum';
import { OtpType } from '../../user-otp/model/otp-type.enum';
import { Stores } from '../model/stores.entity';
import { Orders } from '../../orders/model/order.entity';

describe('StoreService deletion', () => {
  const createHarness = (ownedStores: Partial<Stores>[] = []) => {
    const authenticatedUser = {
      id: 'usr_vendor',
      email: 'merchant@example.com',
    };
    const queryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(ownedStores),
    };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === Stores
          ? { createQueryBuilder: jest.fn(() => queryBuilder) }
          : { count: jest.fn().mockResolvedValue(0) },
      ),
      findOne: jest.fn().mockResolvedValue(null),
      delete: jest.fn(),
      remove: jest.fn(),
      transaction: jest.fn(async (work) => work(manager)),
    };
    const storeRepository = {
      findOne: jest.fn().mockResolvedValue(ownedStores[0] || null),
      count: jest.fn().mockResolvedValue(ownedStores.length),
      manager,
    };
    const commonService = {
      getLoggedInUser: jest.fn().mockResolvedValue(authenticatedUser),
    };
    const userOtpService = {
      sendOTP: jest.fn(),
      verifyOTP: jest.fn(),
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
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      userOtpService as any,
    );
    return { service, manager, userOtpService };
  };

  it('binds the emailed code to the selected store', async () => {
    const stores = [
      { id: 'str_one', userId: 'usr_vendor' },
      { id: 'str_two', userId: 'usr_vendor' },
    ];
    const { service, userOtpService } = createHarness(stores);

    await service.requestStoreDeletionOtp('str_one');

    expect(userOtpService.sendOTP).toHaveBeenCalledWith(
      OtpType.EMAIL,
      'merchant@example.com',
      OtpPurpose.STORE_DELETION,
      'usr_vendor',
      'str_one',
    );
  });

  it('locks all merchant stores and retains at least one store', async () => {
    const stores = [
      { id: 'str_one', userId: 'usr_vendor' },
      { id: 'str_two', userId: 'usr_vendor' },
    ];
    const { service, manager, userOtpService } = createHarness(stores);

    const response = await service.deleteStore('str_one', '1234');

    expect(userOtpService.verifyOTP).toHaveBeenCalledWith(
      '1234',
      'merchant@example.com',
      'usr_vendor',
      OtpType.EMAIL,
      true,
      OtpPurpose.STORE_DELETION,
      'str_one',
    );
    expect(manager.remove).toHaveBeenCalledWith(Stores, stores[0]);
    expect((response as any).data).toEqual({
      deletedStoreId: 'str_one',
      nextStoreId: 'str_two',
    });
    expect(manager.getRepository).toHaveBeenCalledWith(Orders);
  });
});

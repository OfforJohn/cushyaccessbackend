import * as bcrypt from 'bcryptjs';
import { StoreService } from './stores.service';
import { OtpPurpose } from '../../user-otp/model/otp-purpose.enum';
import { OtpType } from '../../user-otp/model/otp-type.enum';
import { Stores } from '../model/stores.entity';

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (value: string) => `hash:${value}`),
  compare: jest.fn(
    async (value: string, hash: string) => hash === `hash:${value}`,
  ),
}));

describe('StoreService branch passwords', () => {
  const createService = (overrides: Record<string, any> = {}) => {
    const authenticatedUser = {
      id: 'usr_vendor',
      email: 'merchant@example.com',
    };
    const queryBuilder = {
      addSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };
    const manager = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => queryBuilder),
      })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      transaction: jest.fn(async (work) => work(manager)),
    };
    const storeRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(2),
      manager,
      ...overrides.storeRepository,
    };
    const usersRepository = {
      findOne: jest.fn(),
      ...overrides.usersRepository,
    };
    const userOtpService = {
      sendOTP: jest.fn(),
      verifyOTP: jest.fn(),
      ...overrides.userOtpService,
    };
    const service = new StoreService(
      storeRepository as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      {} as any,
      {} as any,
      {} as any,
      usersRepository as any,
      {} as any,
      {
        getLoggedInUser: jest.fn().mockResolvedValue(authenticatedUser),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      userOtpService as any,
    );
    return {
      service,
      queryBuilder,
      manager,
      storeRepository,
      usersRepository,
      userOtpService,
    };
  };

  it('switches with the receiving branch password rather than account password', async () => {
    const hash = await bcrypt.hash('branch-secret', 4);
    const harness = createService();
    harness.queryBuilder.getOne.mockResolvedValue({
      id: 'str_two',
      userId: 'usr_vendor',
      branchPasswordHash: hash,
    });

    const response = await harness.service.switchStore(
      'str_two',
      'branch-secret',
    );

    expect((response as any).message).toBe('STORE_SWITCHED_SUCCESSFULLY');
    expect(harness.usersRepository.findOne).not.toHaveBeenCalled();
    expect((response as any).data.store.branchPasswordHash).toBeUndefined();
    expect((response as any).data.store.branchPasswordConfigured).toBe(true);
  });

  it('does not silently fall back to the account password for a legacy branch', async () => {
    const harness = createService();
    harness.queryBuilder.getOne.mockResolvedValue({
      id: 'str_legacy',
      userId: 'usr_vendor',
      branchPasswordHash: null,
    });

    await expect(
      harness.service.switchStore('str_legacy', 'account-password'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'STORE_PASSWORD_NOT_CONFIGURED',
      }),
    });
  });

  it('configures a legacy branch once after checking the account password', async () => {
    const accountHash = await bcrypt.hash('account-secret', 4);
    const harness = createService({
      usersRepository: {
        findOne: jest.fn().mockResolvedValue({ password: accountHash }),
      },
    });
    harness.queryBuilder.getOne.mockResolvedValue({
      id: 'str_legacy',
      userId: 'usr_vendor',
      branchPasswordHash: null,
    });

    await harness.service.configureStorePassword('str_legacy', {
      accountPassword: 'account-secret',
      password: 'new-branch-secret',
    });

    expect(harness.manager.update).toHaveBeenCalledWith(
      Stores,
      { id: 'str_legacy', userId: 'usr_vendor' },
      expect.objectContaining({ branchPasswordHash: expect.any(String) }),
    );
  });

  it('scopes reset OTPs to the selected branch', async () => {
    const harness = createService();
    harness.storeRepository.findOne.mockResolvedValue({
      id: 'str_two',
      userId: 'usr_vendor',
    });

    await harness.service.requestStorePasswordResetOtp('str_two');

    expect(harness.userOtpService.sendOTP).toHaveBeenCalledWith(
      OtpType.EMAIL,
      'merchant@example.com',
      OtpPurpose.STORE_PASSWORD_RESET,
      'usr_vendor',
      'str_two',
    );
  });

  it('does not send a reset OTP for a branch owned by another merchant', async () => {
    const harness = createService();
    harness.storeRepository.findOne.mockResolvedValue(null);

    await expect(
      harness.service.requestStorePasswordResetOtp('str_not_owned'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ message: 'STORE_NOT_FOUND' }),
    });
    expect(harness.userOtpService.sendOTP).not.toHaveBeenCalled();
  });

  it('verifies the selected branch OTP before replacing its password', async () => {
    const harness = createService();
    harness.storeRepository.findOne.mockResolvedValue({
      id: 'str_two',
      userId: 'usr_vendor',
    });

    const response = await harness.service.resetStorePassword('str_two', {
      otp: '1234',
      password: 'new-branch-secret',
    });

    expect(harness.userOtpService.verifyOTP).toHaveBeenCalledWith(
      '1234',
      'merchant@example.com',
      'usr_vendor',
      OtpType.EMAIL,
      true,
      OtpPurpose.STORE_PASSWORD_RESET,
      'str_two',
    );
    expect(harness.storeRepository.update).toHaveBeenCalledWith(
      { id: 'str_two', userId: 'usr_vendor' },
      expect.objectContaining({
        branchPasswordHash: 'hash:new-branch-secret',
        branchPasswordUpdatedAt: expect.any(Date),
      }),
    );
    expect((response as any).message).toBe('STORE_PASSWORD_RESET_SUCCESSFULLY');
  });

  it('does not consume an OTP or update a branch owned by another merchant', async () => {
    const harness = createService();
    harness.storeRepository.findOne.mockResolvedValue(null);

    await expect(
      harness.service.resetStorePassword('str_not_owned', {
        otp: '1234',
        password: 'new-branch-secret',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ message: 'STORE_NOT_FOUND' }),
    });
    expect(harness.userOtpService.verifyOTP).not.toHaveBeenCalled();
    expect(harness.storeRepository.update).not.toHaveBeenCalled();
  });
});

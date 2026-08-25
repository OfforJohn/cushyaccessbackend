import { AdminService } from './admin.service';
import { Stores } from '../../stores/model/stores.entity';
import { Users } from '../../users/model/users.entity';
import { UserCredentials } from '../../users/model/user-credentials.entity';
import { UserCredentialStatus } from '../../users/model/user-credential.enum';
import { UserRoles } from '../../users/model/user-roles.enum';

describe('AdminService vendor verification synchronization', () => {
  const vendor = {
    id: 'vendor_1',
    userRole: UserRoles.VENDOR,
    firstName: 'Cushy',
    lastName: 'Merchant',
    email: 'merchant@example.com',
  };
  const credentials = {
    userId: vendor.id,
    status: UserCredentialStatus.PENDING,
    reason: null,
  };
  const store = {
    id: 'store_1',
    userId: vendor.id,
    name: 'Cushy Kitchen',
    category: 'restaurant',
  };

  const usersRepository = {
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const credentialsRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const storesRepository = {
    update: jest.fn(),
    findOne: jest.fn(),
  };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === Users) return usersRepository;
      if (entity === UserCredentials) return credentialsRepository;
      if (entity === Stores) return storesRepository;
      throw new Error('Unexpected repository');
    }),
  };
  const userRepository = {
    manager: {
      transaction: jest.fn(async (work) => work(manager)),
    },
  };
  const eventBus = { publish: jest.fn() };
  const mailSender = { sendMail: jest.fn() };
  const service = new AdminService(
    userRepository as any,
    storesRepository as any,
    credentialsRepository as any,
    eventBus as any,
    mailSender as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    usersRepository.findOne.mockResolvedValue({ ...vendor });
    credentialsRepository.findOne.mockResolvedValue({ ...credentials });
    credentialsRepository.save.mockImplementation(async (value) => value);
    storesRepository.findOne.mockResolvedValue({ ...store });
    mailSender.sendMail.mockResolvedValue(undefined);
  });

  it('approves the credentials, vendor, and every store together', async () => {
    const response = await service.updateVendorVerificationStatus(vendor.id, {
      status: UserCredentialStatus.APPROVED,
    });

    expect(usersRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        lock: { mode: 'pessimistic_write' },
      }),
    );
    expect(usersRepository.update).toHaveBeenCalledWith(
      vendor.id,
      expect.objectContaining({
        isVerified: true,
        verificationStatus: UserCredentialStatus.APPROVED,
      }),
    );
    expect(storesRepository.update).toHaveBeenCalledWith(
      { userId: vendor.id },
      { isVerified: true },
    );
    expect(response.toJSON().error).toBe(false);
  });

  it('rejects every store and atomically removes stale Featured status', async () => {
    await service.updateVendorVerificationStatus(vendor.id, {
      status: UserCredentialStatus.REJECTED,
      reason: 'Address document is invalid',
    });

    expect(storesRepository.update).toHaveBeenCalledWith(
      { userId: vendor.id },
      {
        isVerified: false,
        isFeatured: false,
        featuredAt: null,
      },
    );
  });

  it('does not report the committed KYC change as failed when email is down', async () => {
    mailSender.sendMail.mockRejectedValueOnce(new Error('SMTP unavailable'));

    const response = await service.updateVendorVerificationStatus(vendor.id, {
      status: UserCredentialStatus.APPROVED,
    });

    expect(response.toJSON().error).toBe(false);
  });
});

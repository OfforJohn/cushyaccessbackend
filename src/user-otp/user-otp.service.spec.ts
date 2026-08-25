import { BadRequestException } from '@nestjs/common';
import { UserOtpService } from './user-otp.service';
import { OtpType } from './model/otp-type.enum';
import { UserOtp } from './model/user-otp.entity';
import { OtpPurpose } from './model/otp-purpose.enum';

describe('UserOtpService.verifyOTP', () => {
  const validOtp = {
    id: 'otp_1',
    otp: '1234',
    reference: 'person@example.com',
    userId: 'user_1',
    otpType: OtpType.EMAIL,
    used: false,
    expiryDate: new Date(Date.now() + 60_000),
  };

  const createService = (
    repositoryOverrides: Record<string, jest.Mock> = {},
  ) => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(validOtp),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
      ...repositoryOverrides,
    };

    const service = new UserOtpService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { service, repository };
  };

  it('requires an OTP before querying storage', async () => {
    const { service, repository } = createService();

    await expect(
      service.verifyOTP(
        '',
        validOtp.reference,
        validOtp.userId,
        validOtp.otpType,
        true,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.findOne).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('does not consume an expired OTP', async () => {
    const { service, repository } = createService({
      findOne: jest.fn().mockResolvedValue({
        ...validOtp,
        expiryDate: new Date(Date.now() - 60_000),
      }),
    });

    await expect(
      service.verifyOTP(
        validOtp.otp,
        validOtp.reference,
        validOtp.userId,
        validOtp.otpType,
        true,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('atomically consumes a valid OTP', async () => {
    const { service, repository } = createService();

    await service.verifyOTP(
      validOtp.otp,
      validOtp.reference,
      validOtp.userId,
      validOtp.otpType,
      true,
    );

    expect(repository.update).toHaveBeenCalledWith(
      { id: validOtp.id, used: false },
      { used: true },
    );
  });

  it('binds a scoped OTP to the requested resource', async () => {
    const { service, repository } = createService();

    await service.verifyOTP(
      validOtp.otp,
      validOtp.reference,
      validOtp.userId,
      validOtp.otpType,
      true,
      OtpPurpose.STORE_DELETION,
      'str_123',
    );

    expect(repository.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        purpose: 'STORE_DELETION:str_123',
      }),
    });
  });

  it('rejects a concurrent reuse when another request consumed it first', async () => {
    const { service } = createService({
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    });

    await expect(
      service.verifyOTP(
        validOtp.otp,
        validOtp.reference,
        validOtp.userId,
        validOtp.otpType,
        true,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('can validate without consuming when use is false', async () => {
    const { service, repository } = createService();

    await service.verifyOTP(
      validOtp.otp,
      validOtp.reference,
      validOtp.userId,
      validOtp.otpType,
      false,
    );

    expect(repository.update).not.toHaveBeenCalled();
  });

  it('counts a wrong code and does not consume it', async () => {
    const { service, repository } = createService();

    await expect(
      service.verifyOTP(
        '9999',
        validOtp.reference,
        validOtp.userId,
        validOtp.otpType,
        false,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.increment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: validOtp.id,
        used: false,
        failedAttempts: expect.any(Object),
      }),
      'failedAttempts',
      1,
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('rejects an OTP after the failed-attempt limit', async () => {
    const { service, repository } = createService({
      findOne: jest.fn().mockResolvedValue({
        ...validOtp,
        failedAttempts: 5,
      }),
    });

    await expect(
      service.verifyOTP(
        validOtp.otp,
        validOtp.reference,
        validOtp.userId,
        validOtp.otpType,
        false,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });
});

describe('UserOtpService.sendOTP', () => {
  const createEmailService = ({
    existing = null,
    deliveryResult = { messageId: 'message_1' },
  }: {
    existing?: UserOtp | null;
    deliveryResult?: unknown;
  } = {}) => {
    const manager = {
      query: jest.fn().mockResolvedValue([{ acquired: true }]),
      findOne: jest.fn().mockResolvedValue(existing),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const repository = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: {
        transaction: jest.fn(
          async (
            operation: (transactionManager: typeof manager) => Promise<unknown>,
          ) => operation(manager),
        ),
      },
    };
    const usersService = {
      findByEmailOrMobile: jest.fn().mockResolvedValue({
        id: 'user_1',
        email: 'person@example.com',
        mobile: '8012345678',
        firstName: 'Test',
        lastName: 'User',
      }),
      findAuthUserById: jest.fn().mockResolvedValue({
        id: 'user_1',
        email: 'person@example.com',
        mobile: '4155552671',
        callingCode: '1',
        firstName: 'Test',
        lastName: 'User',
      }),
    };
    const mailSenderService = {
      sendMail: jest.fn().mockResolvedValue(deliveryResult),
    };
    const service = new UserOtpService(
      repository as never,
      usersService as never,
      mailSenderService as never,
      {} as never,
    );

    return { service, manager, mailSenderService, usersService };
  };

  it('serializes issuance and persists the code before delivery', async () => {
    const { service, manager, mailSenderService } = createEmailService();

    await service.sendOTP(OtpType.EMAIL, 'person@example.com');

    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) AS acquired',
      ['user_1', `${OtpType.EMAIL}:VERIFICATION`],
    );
    expect(manager.delete).toHaveBeenCalled();
    expect(manager.save).toHaveBeenCalled();
    expect(mailSenderService.sendMail).toHaveBeenCalled();
  });

  it('binds authenticated OTP issuance directly to the user id', async () => {
    const { service, usersService } = createEmailService();

    await service.sendOTP(
      OtpType.EMAIL,
      'person@example.com',
      undefined,
      'user_1',
    );

    expect(usersService.findAuthUserById).toHaveBeenCalledWith('user_1');
    expect(usersService.findByEmailOrMobile).not.toHaveBeenCalled();
  });

  it('isolates issuance cooldowns by purpose scope', async () => {
    const { service, manager } = createEmailService();

    await service.sendOTP(
      OtpType.EMAIL,
      'person@example.com',
      OtpPurpose.STORE_DELETION,
      'user_1',
      'str_123',
    );

    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) AS acquired',
      ['user_1', `${OtpType.EMAIL}:STORE_DELETION:str_123`],
    );
  });

  it('enforces the server-side resend cooldown', async () => {
    const { service, manager, mailSenderService } = createEmailService({
      existing: {
        dateCreated: new Date(),
      } as UserOtp,
    });

    await expect(
      service.sendOTP(OtpType.EMAIL, 'person@example.com'),
    ).rejects.toMatchObject({ status: 429 });
    expect(manager.delete).not.toHaveBeenCalled();
    expect(mailSenderService.sendMail).not.toHaveBeenCalled();
  });

  it('fails the transaction when delivery is not confirmed', async () => {
    const { service } = createEmailService({ deliveryResult: null });

    await expect(
      service.sendOTP(OtpType.EMAIL, 'person@example.com'),
    ).rejects.toMatchObject({ status: 503 });
  });
});

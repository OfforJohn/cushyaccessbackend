import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { OtpType } from 'src/user-otp/model/otp-type.enum';
import { Users } from 'src/users/model/users.entity';
import { UserOtp } from 'src/user-otp/model/user-otp.entity';
import { OtpPurpose } from 'src/user-otp/model/otp-purpose.enum';

describe('AuthService password reset flow', () => {
  const user = {
    id: 'user_1',
    email: 'person@example.com',
    mobile: '8012345678',
    sessionVersion: 0,
  } as Users;

  const createService = () => {
    const manager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const usersRepository = {
      manager: {
        transaction: jest.fn(
          async (
            operation: (transactionManager: typeof manager) => Promise<unknown>,
          ) => operation(manager),
        ),
      },
    };
    const userService = {
      findByEmailOrMobile: jest.fn().mockResolvedValue(user),
      invalidateUserCaches: jest.fn().mockResolvedValue(undefined),
    };
    const userOtpService = {
      sendOTP: jest.fn().mockResolvedValue(undefined),
      verifyOTP: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthService(
      usersRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      userService as never,
      {} as never,
      {} as never,
      userOtpService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return {
      service,
      manager,
      usersRepository,
      userService,
      userOtpService,
    };
  };

  it('atomically consumes the OTP, changes the password, and revokes sessions', async () => {
    const { service, manager, userService, userOtpService } = createService();

    await service.verifyAndResetPassword({
      otp: '1234',
      otpType: OtpType.EMAIL,
      emailOrMobile: user.email,
      password: 'updated-password',
    });

    expect(userOtpService.verifyOTP).toHaveBeenCalledWith(
      '1234',
      user.email,
      user.id,
      OtpType.EMAIL,
      false,
      OtpPurpose.PASSWORD_RESET,
    );
    expect(manager.update).toHaveBeenCalledWith(
      UserOtp,
      expect.objectContaining({
        otp: '1234',
        userId: user.id,
        purpose: OtpPurpose.PASSWORD_RESET,
        used: false,
      }),
      { used: true },
    );
    expect(manager.update).toHaveBeenCalledWith(
      Users,
      { id: user.id },
      expect.objectContaining({ password: expect.any(String) }),
    );
    expect(manager.increment).toHaveBeenCalledWith(
      Users,
      { id: user.id },
      'sessionVersion',
      1,
    );
    expect(userService.invalidateUserCaches).toHaveBeenCalledWith(user);
  });

  it('keeps cooldown responses indistinguishable from a successful send', async () => {
    const { service, userOtpService } = createService();
    userOtpService.sendOTP.mockRejectedValue(
      new HttpException('cooldown', HttpStatus.TOO_MANY_REQUESTS),
    );

    const response = await service.sendPasswordResetOTP({
      otpType: OtpType.EMAIL,
      emailOrMobile: user.email,
    });

    expect(response.toJSON()).toMatchObject({
      error: false,
      message: 'OTP_SEND_SUCCESSFULLY',
    });
  });

  it('does not deliver to a channel that conflicts with the identifier', async () => {
    const { service, userOtpService } = createService();

    await service.sendPasswordResetOTP({
      otpType: OtpType.MOBILE,
      emailOrMobile: user.email,
    });

    expect(userOtpService.sendOTP).not.toHaveBeenCalled();
  });
});

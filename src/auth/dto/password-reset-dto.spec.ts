import { validate } from 'class-validator';
import { OtpType } from 'src/user-otp/model/otp-type.enum';
import { PasswordResetRequest } from './password-reset-request.dto';
import { VerifyPasswordOtpDto } from './verify-password-otp.dto';

describe('password reset DTO validation', () => {
  it.each([
    'person@example.com',
    'Person@Example.com',
    '+234 801 234 5678',
    '0801-234-5678',
  ])('accepts a supported identifier: %s', async (emailOrMobile) => {
    const dto = Object.assign(new PasswordResetRequest(), {
      emailOrMobile,
      otpType: emailOrMobile.includes('@') ? OtpType.EMAIL : OtpType.MOBILE,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each(['', 'not-an-identifier', '1234', '()----1', '+12 letters'])(
    'rejects a malformed identifier: %s',
    async (emailOrMobile) => {
      const dto = Object.assign(new PasswordResetRequest(), {
        emailOrMobile,
        otpType: OtpType.MOBILE,
      });

      expect(await validate(dto)).not.toHaveLength(0);
    },
  );

  it('requires an exact four-digit OTP', async () => {
    const dto = Object.assign(new VerifyPasswordOtpDto(), {
      emailOrMobile: 'person@example.com',
      otpType: OtpType.EMAIL,
      otp: '12ab',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});

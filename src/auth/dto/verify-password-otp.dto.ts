import { IsEnum, IsNotEmpty, Matches, MaxLength } from 'class-validator';
import { OtpType } from 'src/user-otp/model/otp-type.enum';
import { PASSWORD_RESET_IDENTIFIER_PATTERN } from './password-reset-identifier';

export class VerifyPasswordOtpDto {
  @IsNotEmpty()
  @Matches(/^\d{4}$/)
  otp: string;

  @IsEnum(OtpType)
  otpType: OtpType;

  @IsNotEmpty()
  @MaxLength(254)
  @Matches(PASSWORD_RESET_IDENTIFIER_PATTERN)
  emailOrMobile: string;
}

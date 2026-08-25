import { IsEnum, IsNotEmpty, IsOptional, Length } from 'class-validator';
import { OtpType } from 'src/user-otp/model/otp-type.enum';

export class OtpRequestDto {
  @IsOptional()
  @Length(4)
  otp: string;

  @IsEnum(OtpType)
  @IsNotEmpty()
  otpType: OtpType;
}

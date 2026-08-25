import { IsNotEmpty, Length } from 'class-validator';

export class ChangePasswordDto {
  @IsNotEmpty()
  @Length(6)
  newPassword: string;

  @IsNotEmpty()
  emailOrMobile: string;

  @IsNotEmpty()
  @Length(6)
  oldPassword: string;
}

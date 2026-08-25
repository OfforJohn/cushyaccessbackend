import { IsOptional, IsString, IsPhoneNumber, IsEnum } from 'class-validator';

export class RegisterRiderDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  email: string;

  @IsPhoneNumber('NG')
  mobile: string;

  @IsString()
  password: string;

}
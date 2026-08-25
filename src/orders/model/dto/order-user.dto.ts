import { IsString, IsNotEmpty, IsEmail } from 'class-validator';

export class OrderUserDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsEmail()
  @IsNotEmpty()
  emailAddress: string;
}

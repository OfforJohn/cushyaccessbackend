import { IsEmail, IsNotEmpty } from 'class-validator';

export class SendTestEmailDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

import { IsEmail, IsString, MaxLength } from 'class-validator';

export class DeleteAccountDto {
  @IsString()
  @IsEmail()
  @MaxLength(320)
  confirmationEmail: string;
}

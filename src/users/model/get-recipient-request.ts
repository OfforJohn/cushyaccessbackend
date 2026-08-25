import { IsEmail, IsNotEmpty } from 'class-validator';

export class GetRecipientRequest {
  @IsEmail()
  @IsNotEmpty({ message: 'email is required' })
  email: string;
}

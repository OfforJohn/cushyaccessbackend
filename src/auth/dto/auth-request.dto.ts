import { IsNotEmpty, IsString, Length } from 'class-validator';

export class AuthRequestDto {
  @IsString()
  @IsNotEmpty()
  emailOrMobile: string;

  @IsString()
  @Length(6)
  password: string;
}

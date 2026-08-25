import { IsNotEmpty, IsString, Length } from 'class-validator';

export class ApiKeyRequest {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @Length(6)
  password: string;
}

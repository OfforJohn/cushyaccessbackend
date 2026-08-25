import { IsNotEmpty, IsString, Length } from 'class-validator';

export class UpdatePinDto {
  @IsString()
  @Length(4, 4)
  oldPin: string;

  @IsString()
  @Length(4, 4)
  pin: string;

  @IsString()
  @IsNotEmpty()
  userId: string;
}

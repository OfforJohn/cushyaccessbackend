import { IsNotEmpty, IsString, Length } from 'class-validator';

export class PinDto {
  @IsString()
  @Length(4, 4)
  pin: string;

  @IsString()
  @IsNotEmpty()
  userId: string;
}

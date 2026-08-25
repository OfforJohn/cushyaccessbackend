import { IsBoolean, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class UpdatePromoCodeDto {
  @Min(0, { message: 'ambassadorsReward must be a positive number' })
  @IsNumber()
  ambassadorsReward?: number;

  @Min(0, { message: 'consumersReward must be a positive number' })
  @IsNumber()
  consumersReward?: number;

  @IsNotEmpty({ message: 'isDisabled must be provided' })
  @IsBoolean()
  isDisabled?: boolean;
}

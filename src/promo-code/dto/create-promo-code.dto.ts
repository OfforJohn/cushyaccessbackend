import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class CreatePromoCodeDto {
  @IsString()
  @IsNotEmpty()
  ambassadorId: string;

  @IsNumber()
  @Min(100)
  ambassadorsReward: number;

  @IsNumber()
  @Min(0)
  consumersReward: number;
}

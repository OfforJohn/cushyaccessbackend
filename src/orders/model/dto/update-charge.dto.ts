import { IsEnum, IsNotEmpty, IsNumber } from 'class-validator';
import { ChargeType } from '../enum/charge-type.enum';

export class UpdateChargeDto {
  @IsNotEmpty({ message: 'name is required' })
  name: string;

  @IsEnum({ enum: ChargeType })
  chargeType: ChargeType;

  @IsNumber()
  value: number;
}

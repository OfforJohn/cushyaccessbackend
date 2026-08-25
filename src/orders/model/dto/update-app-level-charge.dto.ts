import { IsNumber } from 'class-validator';

export class UpdateAppLevelCharge {
  @IsNumber()
  deliveryFeePerKmForBike: number;

  @IsNumber()
  deliveryFeePerKmForVan: number;
}

import { IsEnum, IsNotEmpty } from 'class-validator';
import { VehicleType } from '../enum/vechicle-type.enum';

export class AICalculateLogisticsOrderRequest {
  @IsNotEmpty({ message: 'pickUpLocation is required' })
  pickUpLocation: string;

  @IsNotEmpty({ message: 'dropOffLocation is required' })
  dropOffLocation: string;
}

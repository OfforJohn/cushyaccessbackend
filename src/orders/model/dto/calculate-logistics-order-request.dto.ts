import { IsEnum, IsNotEmpty } from 'class-validator';
import { VehicleType } from '../enum/vechicle-type.enum';

export class CalculateLogisticsOrderRequest {
  @IsNotEmpty({ message: 'pickUpLocation is required' })
  pickUpLocation: string;

  @IsNotEmpty({ message: 'dropOffLocation is required' })
  dropOffLocation: string;

  @IsNotEmpty({ message: 'vehicleType type is required' })
  @IsEnum(VehicleType)
  vehicleType: VehicleType;
}

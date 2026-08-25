import { IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { VehicleType } from '../enum/vechicle-type.enum';
import { OrderTypes } from '../enum/order-types.enum';

export class CalculateOrderRequest {
  @IsNotEmpty({ message: 'pickUpLoactionId is required' })
  pickUpLoactionId: string;

  @IsNotEmpty({ message: 'dropOffLocationId is required' })
  dropOffLocationId: string;

  @IsNotEmpty({ message: 'vechicle type is required' })
  @IsEnum(VehicleType)
  vechicleType: VehicleType;

  // @IsNotEmpty({ message: 'order type is required' })
  @IsEnum(OrderTypes)
  @IsOptional()
  orderType: OrderTypes;
}

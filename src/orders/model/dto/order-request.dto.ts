import { OrderUserDto } from './order-user.dto';
import {
  IsEnum,
  IsString,
  IsNotEmpty,
  ValidateNested,
  IsOptional,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VehicleType } from '../enum/vechicle-type.enum';

export class DeliveryOrderRequest {
  @IsString()
  @IsNotEmpty()
  pickUpLocation: string;

  @IsString()
  @IsNotEmpty()
  dropOffLocation: string;

  @IsString()
  @IsOptional()
  noteForRider: string;

  @IsString()
  @IsOptional()
  noteForVendor: string;

  @ValidateNested()
  @Type(() => OrderUserDto)
  @IsNotEmpty()
  recipientInfo: OrderUserDto;

  @ValidateNested()
  @Type(() => OrderUserDto)
  @IsNotEmpty()
  senderInfo: OrderUserDto;

  @IsEnum(VehicleType)
  vehicleType: VehicleType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  items: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalItems?: number;
}

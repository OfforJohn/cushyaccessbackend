import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { VehicleType } from '../enum/vechicle-type.enum';

export class CreateCartDto {
  @IsNotEmpty()
  @IsString()
  pickUpLocationId: string;

  @IsNotEmpty()
  @IsString()
  dropOffLocationId: string;

  @IsNotEmpty()
  @IsString()
  vechicleType: VehicleType;

  @IsOptional()
  @IsString()
  noteForRider: string;

  @IsOptional()
  @IsString()
  noteForVendor: string;
}
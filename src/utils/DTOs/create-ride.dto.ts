import { IsString, IsNumber, IsBoolean, IsEmail, IsOptional } from 'class-validator';

export class CreateRideDto {
  @IsString()
  customer_name: string;

  @IsString()
  phone_number: string;

  @IsEmail()
  email: string;

  @IsString()
  pickup_address: string;

  @IsString()
  pickup_contact_name: string;

  @IsString()
  pickup_phone: string;

  @IsEmail()
  pickup_email: string;

  @IsString()
  @IsOptional()
  pickup_instructions?: string;

  @IsString()
  estimated_pickup_time: string;

  @IsString()
  address: string;

  @IsString()
  eta: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsNumber()
  items_count: number;
}

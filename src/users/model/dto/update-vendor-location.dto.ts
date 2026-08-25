import { IsOptional, IsString } from 'class-validator';

export class UpdateVendorLocationDto {
  @IsString()
  country: string;

  @IsString()
  state: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  address: string;

  @IsString()
  @IsOptional()
  latitude?: string;

  @IsString()
  @IsOptional()
  longitude?: string;

  @IsString()
  @IsOptional()
  placeId?: string;
}

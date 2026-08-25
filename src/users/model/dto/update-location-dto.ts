import { IsEnum, IsOptional, IsString } from 'class-validator';

enum LocationType {
  USER = 'CUSTOMER',
  VENDOR = 'VENDOR',
}

export class UpdateLocationDto {
  @IsString()
  @IsOptional()
  longitude?: string;

  @IsString()
  @IsOptional()
  latitude?: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  placeId?: string;

  @IsEnum(LocationType)
  @IsOptional()
  type?: LocationType;
}

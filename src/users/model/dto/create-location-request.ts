import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateLocationRequest {
  @IsString()
  @IsNotEmpty({ message: 'Country is required' })
  country: string;

  @IsString()
  @IsNotEmpty({ message: 'State is required' })
  state: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsNotEmpty({ message: 'Address is required' })
  address: string;

  @IsString()
  @IsNotEmpty({ message: 'LandMark is required' })
  landMark: string;

  @IsString()
  @IsNotEmpty({ message: 'Latitude is required' })
  latitude: string;

  @IsString()
  @IsNotEmpty({ message: 'Longitude is required' })
  longitude: string;

  @IsString()
  @IsOptional()
  placeId?: string;

  @IsNotEmpty({ message: 'isSupported is required' })
  isSupported: boolean;
}

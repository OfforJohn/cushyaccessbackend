import { IsNotEmpty, IsString, IsUrl, IsOptional } from 'class-validator';

export class UpdateVendorCategoryDto {
  @IsOptional()
  @IsString()
  key: string;

  @IsOptional()
  @IsString()
  title: string;

  @IsOptional()
  @IsUrl()
  url: string;

  @IsOptional()
  @IsString()
  color: string;

  @IsOptional()
  isAvailable?: boolean;
}

import { IsNotEmpty, IsString, IsUrl, IsOptional } from 'class-validator';

export class CreateVendorCategoryDto {
  @IsNotEmpty()
  @IsString()
  key: string;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsUrl()
  url: string;

  @IsNotEmpty()
  @IsString()
  color: string;

  @IsOptional()
  isAvailable?: boolean;
}

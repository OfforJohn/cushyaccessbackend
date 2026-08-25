import { IsOptional, IsString, IsArray, IsUrl, IsJSON } from 'class-validator';

export class SendInAppNotificationDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  backgroundColor?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsArray()
  badges?: string[];

  @IsOptional()
  features?: any[];

  @IsOptional()
  cta?: any;

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @IsString()
  url?: string;
}
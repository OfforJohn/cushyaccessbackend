import { IsOptional, IsString, IsObject } from 'class-validator';

export class SendSystemNotificationDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, any>;
}
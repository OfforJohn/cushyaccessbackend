import { IsEnum, IsOptional, IsNumber, IsString, IsObject } from 'class-validator';
import { AlertType } from '../enums/alert-type.enum';
import { AlertSeverity } from '../enums/alert-severity.enum';

export class CreateAlertDto {
  @IsEnum(AlertType)
  type: AlertType;

  @IsEnum(AlertSeverity)
  @IsOptional()
  severity?: AlertSeverity;

  @IsNumber()
  thresholdValue: number;

  @IsString()
  @IsOptional()
  message?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @IsString()
  @IsOptional()
  notificationChannels?: string[];
}
import { IsString, IsOptional, IsEnum, IsArray, IsObject } from 'class-validator';
import { IncidentPriority } from '../enums/incident-priority.enum';

export class CreateIncidentDto {
  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(IncidentPriority)
  @IsOptional()
  priority?: IncidentPriority;

  @IsString()
  @IsOptional()
  detectedBy?: string;

  @IsString()
  @IsOptional()
  detectingSystem?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  affectedServices?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  relatedAlertIds?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}
import { IsString, IsOptional } from 'class-validator';

export class AcknowledgeAlertDto {
  @IsString()
  userId: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
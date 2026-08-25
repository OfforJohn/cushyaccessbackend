import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ConsultationType } from '../models/enums/consultation-type.enum';
import { DayOfWeek } from '../models/enums/day-of-week.enum';

export class AvailableDoctorsQueryDto {
  @IsOptional()
  @IsEnum(ConsultationType)
  consultationType: ConsultationType;

  @IsEnum(DayOfWeek)
  day: DayOfWeek;

  @IsOptional()
  @IsString()
  time?: string; // HH:mm
}

import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { DayOfWeek } from '../models/enums/day-of-week.enum';

export class DayScheduleDto {
  @IsEnum(DayOfWeek)
  day: DayOfWeek;

  @IsOptional()
  @IsString()
  openTime?: string; // "09:00"

  @IsOptional()
  @IsString()
  closeTime?: string; // "17:00"

  @IsBoolean()
  isDayOff: boolean;
}

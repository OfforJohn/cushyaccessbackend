// src/schedule/dto/save-schedule.dto.ts
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsString } from 'class-validator';
import { DayScheduleDto } from './day-schedule.dto';
import { ConsultationType } from '../models/enums/consultation-type.enum';

export class SaveScheduleDto {
  @IsEnum(ConsultationType)
  consultationType: ConsultationType;

  @IsArray()
  @Type(() => DayScheduleDto)
  schedules: DayScheduleDto[];
}

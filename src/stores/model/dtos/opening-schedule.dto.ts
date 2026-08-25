import {
  IsBoolean,
  IsEnum,
  IsOptional,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryType } from '../enums/delivery-type.enum';
import { ScheduleTime } from '../enums/schedule-time.enum';

class DaySchedule {
  // @IsNotEmpty({ message: 'Day is required' })
  // id: string;
  // @IsEnum(Days, { message: 'Invalid day' })
  // day: Days;
  @ValidateIf((schedule: DaySchedule) => !schedule.isClosed)
  @IsEnum(ScheduleTime, { message: 'Invalid open time' })
  openTime?: ScheduleTime;

  @ValidateIf((schedule: DaySchedule) => !schedule.isClosed)
  @IsEnum(ScheduleTime, { message: 'Invalid close time' })
  closeTime?: ScheduleTime;

  @IsOptional()
  @IsBoolean()
  isClosed?: boolean = false;
}

export class OpeningScheduleRequest {
  @ValidateNested()
  @Type(() => DaySchedule)
  sunday: DaySchedule;

  @ValidateNested()
  @Type(() => DaySchedule)
  monday: DaySchedule;

  @ValidateNested()
  @Type(() => DaySchedule)
  tuesday: DaySchedule;

  @ValidateNested()
  @Type(() => DaySchedule)
  wednessday: DaySchedule;

  @ValidateNested()
  @Type(() => DaySchedule)
  thursday: DaySchedule;

  @ValidateNested()
  @Type(() => DaySchedule)
  friday: DaySchedule;

  @ValidateNested()
  @Type(() => DaySchedule)
  saturday: DaySchedule;

  @IsEnum(DeliveryType, {
    message: "Invalid delivery type expected 'PICKUP' or 'DELIVERY' ",
  })
  deliveryType: DeliveryType;
}

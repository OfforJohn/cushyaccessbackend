import { IsEnum, IsNotEmpty, IsString, Matches } from 'class-validator';
import { ConsultationType } from '../models/enums/consultation-type.enum';
import { DayOfWeek } from '../models/enums/day-of-week.enum';

export class BookAppointmentDto {
  @IsString()
  @IsNotEmpty()
  doctorId: string;

  @IsEnum(ConsultationType, {
    message: 'Invalid consultation type',
  })
  consultationType: ConsultationType;

  @IsEnum(DayOfWeek, {
    message: 'Invalid day of week',
  })
  day?: DayOfWeek;
  @IsString()
  selectedDate?: string; // NEW: User selected date (YYYY-MM-DD)

  @IsString()
  selectedTime?: string; // NEW: User selected time (HH:MM)
}

import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ConsultationType } from '../models/enums/consultation-type.enum';

export class GetAvailableSlotsDto {
  @IsString()
  @IsNotEmpty()
  doctorId: string;
  @IsEnum(ConsultationType, {
    message: 'Invalid consultation type',
  })
  consultationType: ConsultationType;

  @IsString()
  @IsNotEmpty()
  selectedDate?: string;
}

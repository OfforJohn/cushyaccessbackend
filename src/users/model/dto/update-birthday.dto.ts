import { IsDateString, IsNotEmpty } from 'class-validator';

export class UpdateBirthdayDto {
  @IsNotEmpty()
  @IsDateString({}, { message: 'dateOfBirth must use YYYY-MM-DD format' })
  dateOfBirth: string;
}

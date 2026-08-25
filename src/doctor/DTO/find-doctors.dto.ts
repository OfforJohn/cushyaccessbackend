import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class FindDoctorsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  symptoms: string;
}

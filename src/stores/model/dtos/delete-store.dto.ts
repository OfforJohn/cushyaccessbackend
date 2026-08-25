import { IsString, Length, Matches } from 'class-validator';

export class DeleteStoreDto {
  @IsString()
  @Length(4, 4)
  @Matches(/^\d{4}$/)
  otp: string;
}

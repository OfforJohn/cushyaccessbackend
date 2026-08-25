import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { BikeType } from '../../riders/model/rider.entity';
import { IsRegistrationPhone } from '../../users/model/dto/registration-phone.validator';

export class CreateRiderDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsRegistrationPhone({
    message: 'mobile must be valid for the selected country',
  })
  mobile: string;

  @IsString()
  @IsNotEmpty()
  callingCode: string;

  @IsString()
  @IsNotEmpty()
  countryCode: string;

  @IsString()
  @Length(8, 72)
  password: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(BikeType)
  bikeType?: BikeType;

  @IsOptional()
  @IsString()
  bikeBrand?: string;

  @IsOptional()
  @IsString()
  bikeModel?: string;

  @IsOptional()
  @IsString()
  bikeColor?: string;

  @IsOptional()
  @IsString()
  licensePlate?: string;
}

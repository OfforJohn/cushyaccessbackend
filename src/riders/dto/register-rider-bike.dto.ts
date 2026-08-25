import {
  IsString,
  IsEmail,
  IsPhoneNumber,
  IsEnum,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsDateString,
  Min,
  Max,
  Matches,
  ValidateNested,
  IsArray,
  Length,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BikeType } from '../model/rider.entity';

export class RiderPersonalInfoDto {
  @IsString()
  @Length(2, 50)
  firstName: string;

  @IsString()
  @Length(2, 50)
  lastName: string;

  @IsString()
  @Length(2, 50)
  username: string;

  @IsEmail()
  email: string;

  @IsPhoneNumber()
  phoneNumber: string;

  @IsString()
  callingCode: string;

  @IsString()
  countryCode: string;

  @IsDateString()
  dateOfBirth: string;

  @IsString()
  address: string;

  @IsString()
  city: string;

  @IsString()
  state: string;

  @IsString()
  @Matches(/^\d{5,6}$/, { message: 'Postal code must be 5-6 digits' })
  postalCode: string;

  @IsString()
  country: string;
}

export class BikeInfoDto {
  @IsEnum(BikeType)
  bikeType: BikeType;

  @IsString()
  bikeBrand: string;

  @IsString()
  bikeModel: string;

  @IsString()
  bikeColor: string;

  @IsNumber()
  @Min(2000)
  @Max(new Date().getFullYear() + 1)
  bikeYear: number;

  @IsString()
  @Matches(/^[A-Z0-9-]+$/, { message: 'License plate must be alphanumeric' })
  licensePlate: string;

  @IsOptional()
  @IsString()
  engineDisplacement?: string;

  @IsBoolean()
  hasHelmet: boolean;

  @IsBoolean()
  hasPhoneMount: boolean;

  @IsBoolean()
  hasDeliveryBag: boolean;
}

export class LicenseInfoDto {
  @IsString()
  licenseNumber: string;

  @IsString()
  licenseClass: string;

  @IsDateString()
  licenseExpiryDate: string;

  @IsOptional()
  @IsString()
  issuingAuthority?: string;
}

export class EmergencyContactDto {
  @IsString()
  fullName: string;

  @IsPhoneNumber()
  phoneNumber: string;

  @IsString()
  relationship: string;
}

export class BankDetailsDto {
  @IsString()
  accountHolderName: string;

  @IsString()
  bankName: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'Account number must contain only digits' })
  accountNumber: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'Bank code must contain only digits' })
  bankCode: string;
}

export class RegisterBikeRiderDto {
  @ValidateNested()
  @Type(() => RiderPersonalInfoDto)
  personalInfo: RiderPersonalInfoDto;

  @ValidateNested()
  @Type(() => BikeInfoDto)
  bikeInfo: BikeInfoDto;

  @ValidateNested()
  @Type(() => LicenseInfoDto)
  licenseInfo: LicenseInfoDto;

  @ValidateNested()
  @Type(() => EmergencyContactDto)
  emergencyContact: EmergencyContactDto;

  @ValidateNested()
  @Type(() => BankDetailsDto)
  bankDetails: BankDetailsDto;

  @IsBoolean()
  agreeToTerms: boolean;

  @IsBoolean()
  backgroundCheckConsent: boolean;

  @IsBoolean()
  dataProcessingConsent: boolean;

  @IsOptional()
  @IsString()
  @IsUrl()
  profilePhoto?: string;
}

export class RiderRegistrationResponseDto {
  riderId: string;
  status: string;
  message: string;
}
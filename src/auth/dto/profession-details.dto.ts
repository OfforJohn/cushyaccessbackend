import {
  IsString,
  IsOptional,
  IsNumber,
  IsUUID,
  IsDecimal,
  IsNotEmpty,
} from 'class-validator';

export class CreateProfessionDetailsDto {
  @IsString()
  @IsOptional()
  medicalLicenseNumber: string;

  @IsString()
  @IsOptional()
  highestQualification: string;

  @IsString()
  @IsOptional()
  specialty: string;

  @IsNumber()
  @IsOptional()
  yearOfExperience: number;

  @IsString()
  @IsOptional()
  medicalInstitution: string;

  @IsString()
  @IsOptional()
  languageSpoken: string;

  @IsOptional()
  @IsString()
  professionalBio?: string;

  @IsString()
  @IsOptional()
  medicalLicense: string;

  @IsString()
  @IsOptional()
  governmentId: string;

  @IsOptional()
  @IsString()
  professionalCertificate?: string;
}

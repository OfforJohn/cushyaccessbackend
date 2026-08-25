import { Type } from 'class-transformer';
import { IsOptional, IsEnum, IsDateString, IsNumber } from 'class-validator';

export enum VendorVerificationStatus {
  VERIFIED = 'VERIFIED',
  UNVERIFIED = 'UNVERIFIED',
}

export class VendorListDto {
  @IsOptional()
  @IsEnum(VendorVerificationStatus, {
    message: 'Status must be either VERIFIED or UNVERIFIED',
  })
  status?: VendorVerificationStatus;

  @IsOptional()
  @IsDateString({}, { message: 'createdFrom must be a valid ISO date string' })
  createdFrom?: string;

  @IsOptional()
  @IsDateString({}, { message: 'createdTo must be a valid ISO date string' })
  createdTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  size?: number;
}

import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UploadRiderDocumentsDto {
  @IsOptional()
  @IsIn(['2'])
  onboardingVersion?: '2';

  @IsOptional()
  @IsString()
  @MaxLength(30)
  bikeType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  bikeBrand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  bikeModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  bikeColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^[A-Za-z0-9 -]+$/, {
    message: 'License plate contains unsupported characters',
  })
  licensePlate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  streetAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[+0-9() -]{7,30}$/, {
    message: 'Emergency contact phone is invalid',
  })
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  emergencyContactRelationship?: string;
}

import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ReportMobileErrorDto {
  @IsString()
  @MaxLength(500)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  stack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  componentStack?: string;

  @IsBoolean()
  fatal: boolean;

  @IsString()
  @IsIn(['android', 'ios', 'web', 'unknown'])
  platform: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  route?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  release?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  updateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  runtimeVersion?: string;
}

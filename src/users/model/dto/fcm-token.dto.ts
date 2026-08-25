import { UserRoles } from '../user-roles.enum';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsBoolean,
  IsEnum,
} from 'class-validator';

export class FCMTokenDto {
  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  subtitle?: string;

  @IsString()
  body: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  userIds?: string[];

  @IsBoolean()
  @IsOptional()
  roleBaseSend?: boolean;

  @IsEnum(UserRoles)
  @IsOptional()
  role?: UserRoles;

  @IsBoolean()
  @IsOptional()
  toAll?: boolean;

  @IsBoolean()
  @IsOptional()
  onlineRidersOnly?: boolean;

  @IsOptional()
  data?: any;

  @IsString()
  @IsOptional()
  sound?: string;
}

export class CreateFCMTokenDto {
  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @IsOptional()
  deviceName?: string;

  @IsString()
  @IsOptional()
  fcmToken?: string;
}

export class DisableFCMTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

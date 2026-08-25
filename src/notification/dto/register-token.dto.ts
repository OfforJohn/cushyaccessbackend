import { IsString, Matches, IsOptional } from 'class-validator';

export class RegisterTokenDto {
  @IsString()
  @Matches(/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/, {
    message: 'Token must be a valid Expo push token',
  })
  token: string;

  @IsString()
  @IsOptional()
  deviceName?: string;

  @IsString()
  @IsOptional()
  fcmToken?: string;
}

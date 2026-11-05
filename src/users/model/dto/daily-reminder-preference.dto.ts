import { IsBoolean, IsString, Matches, MaxLength } from 'class-validator';

export class DailyReminderPreferenceDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'time must use 24-hour HH:mm format',
  })
  time: string;

  @IsString()
  @MaxLength(100)
  timeZone: string;
}

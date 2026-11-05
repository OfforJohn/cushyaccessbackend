import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyReminderPreferenceDto } from '../model/dto/daily-reminder-preference.dto';
import { Users } from '../model/users.entity';

export type DailyReminderPreference = {
  enabled: boolean;
  time: string;
  timeZone: string;
};

@Injectable()
export class DailyReminderPreferenceService {
  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
  ) {}

  async getPreference(userId: string): Promise<DailyReminderPreference> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: {
        id: true,
        dailyReminderEnabled: true,
        dailyReminderTime: true,
        dailyReminderTimeZone: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return this.toPreference(user);
  }

  async updatePreference(
    userId: string,
    preference: DailyReminderPreferenceDto,
  ): Promise<DailyReminderPreference> {
    this.validateTimeZone(preference.timeZone);

    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    user.dailyReminderEnabled = preference.enabled;
    user.dailyReminderTime = preference.time;
    user.dailyReminderTimeZone = preference.timeZone;

    return this.toPreference(await this.usersRepository.save(user));
  }

  private validateTimeZone(timeZone: string): void {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format();
    } catch {
      throw new BadRequestException('timeZone must be a valid IANA time zone.');
    }
  }

  private toPreference(user: Users): DailyReminderPreference {
    return {
      enabled: user.dailyReminderEnabled,
      time: user.dailyReminderTime,
      timeZone: user.dailyReminderTimeZone,
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationService } from './notification.service';
import { Users } from '../../users/model/users.entity';

type DueDailyReminder = {
  userId: string;
  localDate: string;
};

const SEND_CONCURRENCY = 10;

@Injectable()
export class DailyReminderSchedulerService {
  private readonly logger = new Logger(DailyReminderSchedulerService.name);
  private isRunning = false;

  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sendDueDailyReminders(): Promise<void> {
    if (process.env.APP_ROLE !== 'worker' || this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      const dueUsers: DueDailyReminder[] = await this.usersRepository.query(`
        SELECT
          user_row."id" AS "userId",
          TO_CHAR(
            CURRENT_TIMESTAMP AT TIME ZONE user_row."dailyReminderTimeZone",
            'YYYY-MM-DD'
          ) AS "localDate"
        FROM "users" user_row
        WHERE user_row."dailyReminderEnabled" = true
          AND user_row."dailyReminderTime" <= TO_CHAR(
            CURRENT_TIMESTAMP AT TIME ZONE user_row."dailyReminderTimeZone",
            'HH24:MI'
          )
          AND user_row."dailyReminderLastSentDate" IS DISTINCT FROM TO_CHAR(
            CURRENT_TIMESTAMP AT TIME ZONE user_row."dailyReminderTimeZone",
            'YYYY-MM-DD'
          )
          AND EXISTS (
            SELECT 1
            FROM "fcm_token" token_row
            WHERE token_row."userId" = user_row."id"
              AND token_row."isDisabled" = false
              AND COALESCE(token_row."expoToken", token_row."token")
                ~ '^(ExponentPushToken|ExpoPushToken)\\[[^]]+\\]$'
          )
        ORDER BY user_row."id"
      `);

      for (let offset = 0; offset < dueUsers.length; offset += SEND_CONCURRENCY) {
        const batch = dueUsers.slice(offset, offset + SEND_CONCURRENCY);
        await Promise.all(batch.map((dueUser) => this.sendReminder(dueUser)));
      }
    } catch (error) {
      this.logger.error(
        `Could not process daily reminders: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async sendReminder(dueUser: DueDailyReminder): Promise<void> {
    try {
      const delivery = await this.notificationService.sendToUser(
        dueUser.userId,
        'Your daily reminder',
        "It's time for your daily check-in.",
        { type: 'DAILY_REMINDER' },
      );

      if (delivery.sent === 0) {
        return;
      }

      await this.usersRepository
        .createQueryBuilder()
        .update(Users)
        .set({ dailyReminderLastSentDate: dueUser.localDate })
        .where('"id" = :userId', { userId: dueUser.userId })
        .andWhere('"dailyReminderLastSentDate" IS DISTINCT FROM :localDate', {
          localDate: dueUser.localDate,
        })
        .execute();
    } catch (error) {
      this.logger.error(
        `Daily reminder failed for user ${dueUser.userId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}

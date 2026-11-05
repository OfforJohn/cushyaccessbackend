import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sendDueDailyReminders(): Promise<void> {
    if (this.isRunning) return;
    const queryRunner = this.dataSource.createQueryRunner();
    let connected = false;
    let lockAcquired = false;
    try {
      await queryRunner.connect();
      connected = true;
      const [lock] = await queryRunner.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        ['daily-push-reminder-scheduler'],
      );
      if (lock?.acquired !== true) return;

      lockAcquired = true;
      this.isRunning = true;
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
      try {
        if (lockAcquired) {
          await queryRunner.query(
            'SELECT pg_advisory_unlock(hashtext($1))',
            ['daily-push-reminder-scheduler'],
          );
        }
      } catch (error) {
        this.logger.error(
          `Could not release daily reminder scheduler lock: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
      if (connected) {
        try {
          await queryRunner.release();
        } catch (error) {
          this.logger.error(
            `Could not release daily reminder database connection: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        }
      }
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

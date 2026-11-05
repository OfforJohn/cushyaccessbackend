import { Module } from '@nestjs/common';
import { UsersModule } from 'src/users/users.module';
import { AnalyticsModule } from 'src/analytics/analytics.module';
import { NotificationService } from './services/notification.service';
import { NotificationController } from './controllers/notification.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from 'src/users/model/users.entity';
import { DailyReminderSchedulerService } from './services/daily-reminder-scheduler.service';

@Module({
  imports: [UsersModule, AnalyticsModule, TypeOrmModule.forFeature([Users])],
  providers: [NotificationService, DailyReminderSchedulerService],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}

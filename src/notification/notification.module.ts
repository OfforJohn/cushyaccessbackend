import { Module } from '@nestjs/common';
import { UsersModule } from 'src/users/users.module';
import { AnalyticsModule } from 'src/analytics/analytics.module';
import { NotificationService } from './services/notification.service';
import { NotificationController } from './controllers/notification.controller';

@Module({
  imports: [UsersModule, AnalyticsModule],
  providers: [NotificationService],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}

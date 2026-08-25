// analytics/analytics.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { Analytics } from './entities/analytics.entity';
import { UserActivity } from './entities/user-activity.entity';
import { Users } from '../users/model/users.entity';
import { MobileErrorController } from './mobile-error.controller';
import { MobileErrorReport } from './entities/mobile-error-report.entity';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Analytics, UserActivity, Users, MobileErrorReport]),
    CommonModule,
  ],
  controllers: [AnalyticsController, MobileErrorController],
  providers: [
    AnalyticsService,
    // {
    //   provide: APP_INTERCEPTOR,
    //   useClass: AnalyticsInterceptor,
    // },
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}

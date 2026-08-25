import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from './common/common.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserOtpModule } from './user-otp/user-otp.module';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/service/jwt-auth.guard';
import { RoleGuard } from './auth/service/roles.guard';
import { AdminRoleGuard } from './auth/service/admin-roles.guard';
import * as path from 'path';
import * as fs from 'fs';
import { StoresModule } from './stores/stores.module';
import { WalletModule } from './wallet/wallet.module';
import { AdvertisementModule } from './advertisement/advertisement.module';
import { RedisCacheModule } from './redis-cache/redis-cache.module';
import { OrderModule } from './orders/orders.module';
import { AdminModule } from './admin/admin.module';
import { PromoCodeModule } from './promo-code/promo-code.module';
import { CqrsModule } from '@nestjs/cqrs';
import { ApiKeyModule } from './api-keys/api-key.module';
import { ApiKeyGuard } from './api-keys/api-key.guards';
import { HealthCheckModule } from './health_check/health_check.module';
import { AppLevelChargesModule } from './app-level-charge/app-level-charges.module';
import { CushyAIModule } from './cushy-ai/cushy-ai.module';
import { DoctorModule } from './doctor/doctor.module';
import { NotificationModule } from './notification/notification.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { RidersModule } from './riders/riders.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { HybridThrottlerGuard } from './common/guards/hybrid-throttler.guard';
import { shouldSynchronizeDatabase } from './database-synchronization';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    ConfigModule.forRoot({ envFilePath: '.env', isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const nodeEnv = configService.get<string>('NODE_ENV');
        const appRole = configService.get<string>('APP_ROLE');
        return {
          type: 'postgres',
          host: configService.get<string>('DB_HOST'),
          port: configService.get<number>('DB_PORT'),
          username: configService.get<string>('DB_USERNAME'),
          password: configService.get<string>('DB_PASSWORD'),
          database: configService.get<string>('DB_DATABASE'),
          entities: [path.join(__dirname, '**', '*.entity.{ts,js}')],
          // Production currently relies on schema synchronization. Restrict it
          // to the single worker so clustered API instances cannot race each
          // other while adding the same column. The deploy hook waits for this
          // worker to finish booting before it starts the API cluster.
          synchronize: shouldSynchronizeDatabase(nodeEnv, appRole),
          extra: {
            statement_timeout: 60000, // 60 seconds
          },
          autoLoadEntities: true,
          ssl: {
            require: true,
            rejectUnauthorized: false,
            ca: fs.readFileSync(path.join(process.cwd(), 'src', 'ca.pem')),
          },
        };
      },
    }),
    CommonModule,
    OnboardingModule,
    UserOtpModule,
    StoresModule,
    WalletModule,
    AdvertisementModule,
    RedisCacheModule,
    OrderModule,
    ApiKeyModule,
    AdminModule,
    PromoCodeModule,
    CqrsModule.forRoot(),
    EventEmitterModule.forRoot(),
    HealthCheckModule,
    AppLevelChargesModule,
    CushyAIModule,
    DoctorModule,
    NotificationModule,
    AnalyticsModule,
    RidersModule,
    MonitoringModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: HybridThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RoleGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AdminRoleGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}

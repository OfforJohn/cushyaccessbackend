import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './service/auth.service';
import { UsersModule } from 'src/users/users.module';
import { JwtModule } from '@nestjs/jwt';
import { UserOtpModule } from 'src/user-otp/user-otp.module';
import { OnboardingModule } from 'src/onboarding/onboarding.module';
import * as dotenv from 'dotenv';
import { CommonModule } from '../common/common.module';
import { Reflector } from '@nestjs/core';
import { ApiKeyModule } from '../api-keys/api-key.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from 'src/users/model/users.entity';
import { UserLocations } from 'src/users/model/user-locations.entity';
import { RedisCacheModule } from 'src/redis-cache/redis-cache.module';
import { Wallets } from 'src/wallet/model/wallet.entity';
import { Stores } from 'src/stores/model/stores.entity';
import { ProfessionDetails } from 'src/doctor/models/professional-details.entity';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { Analytics } from 'src/analytics/entities/analytics.entity';
import { UserActivity } from 'src/analytics/entities/user-activity.entity';
import { Rider } from 'src/riders/model/rider.entity';
import { DeletePlatformAccountUseCase } from 'src/admin/usecases/delete-platform-account.usecase';
import { S3Service } from 'src/utils/s3-bucket.service';
import { WsJwtGuard } from './service/ws-jwt.guard';

dotenv.config();
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Users,
      UserLocations,
      Wallets,
      Stores,
      ProfessionDetails,
      Analytics,
      UserActivity,
      Rider,
    ]),
    UsersModule,
    UserOtpModule,
    OnboardingModule,
    CommonModule,
    RedisCacheModule,
    Reflector,
    ApiKeyModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '30d' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AnalyticsService,
    DeletePlatformAccountUseCase,
    S3Service,
    WsJwtGuard,
  ],
  exports: [WsJwtGuard],
})
export class AuthModule {}

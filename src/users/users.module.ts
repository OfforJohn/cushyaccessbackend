import { Module } from '@nestjs/common';
import { UsersService } from './services/users.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from './model/users.entity';
import { OnboardingModule } from 'src/onboarding/onboarding.module';
import { UsersController } from './controllers/users.controller';
import { UserLocations } from './model/user-locations.entity';
import { UserLocationsService } from './services/user-locations.service';
import { UserLocationsController } from './controllers/user-locations.controller';
import { CommonModule } from '../common/common.module';
import { UsersDetailsService } from './services/user-details.service';
import { RedisCacheModule } from '../redis-cache/redis-cache.module';
import { UserCredentialsController } from './controllers/user-credentials.controller';
import { UserCredentialsService } from './services/user-credential.service';
import { UserCredentials } from './model/user-credentials.entity';
import { VendorCategoryService } from './services/vendor-category.service';
import { VendorCategoryController } from './controllers/vendor-category.controller';
import { VendorCategory } from './model/vendor-category.entity';
import { CategoryInitService } from './services/category-init.service';
import { PushNotificationEventHandler } from './handlers/push-notification-event.handler';
import { FCMTokenService } from './services/fcm-token.service';
import { FCMToken } from './model/fcm-token.entity';
import { FCMTokenController } from './controllers/fcm-token.controller';
import { GoogleMapsService } from 'src/utils/google-maps.service';
import { CqrsModule } from '@nestjs/cqrs';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Users,
      UserLocations,
      UserCredentials,
      VendorCategory,
      FCMToken,
    ]),
    OnboardingModule,
    CommonModule,
    RedisCacheModule,
    CqrsModule,
  ],
  providers: [
    UsersService,
    UserLocationsService,
    UsersDetailsService,
    UserCredentialsService,
    VendorCategoryService,
    CategoryInitService,
    FCMTokenService,
    PushNotificationEventHandler,
    GoogleMapsService,
  ],
  controllers: [
    UsersController,
    UserLocationsController,
    UserCredentialsController,
    VendorCategoryController,
    FCMTokenController,
  ],
  exports: [
    UsersService,
    FCMTokenService,
    UserLocationsService,
    UsersDetailsService,
    VendorCategoryService,
  ],
})
export class UsersModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stores } from './model/stores.entity';
import { OpeningSchedule } from './model/opening-schedule.entity';
import { StoreService } from './services/stores.service';
import { PaymentInfo } from './model/payment-info.entity';
import { CommonModule } from '../common/common.module';
import { UsersModule } from '../users/users.module';
import { StoresController } from './controllers/stores.controller';
import { DaySchedule } from './model/day-schedules';
import { MenuCategoryService } from './services/menu-category.service';
import { MenuCategory } from './model/menu-category.entity';
import { MenuPack } from './model/menu-pack.entity';
import { MenuPackController } from './controllers/menu-pack.controller';
import { MenuPackService } from './services/menu-pack.service';
import { MenuCategoryController } from './controllers/menu-category.controller';
import { MenuItemController } from './controllers/menu-item.controller';
import { MenuItemService } from './services/menu-item.service';
import { MenuItem } from './model/menu-item.entity';
import { S3Service } from 'src/utils/s3-bucket.service';
import { AppSetting } from 'src/admin/models/app-settings.entity';
import { UploadMerchantDocumentsService } from './services/upload-merchant-doc.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { Analytics } from 'src/analytics/entities/analytics.entity';
import { UserActivity } from 'src/analytics/entities/user-activity.entity';
import { Users } from 'src/users/model/users.entity';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { MenuDiscountCronService } from './services/menu-discount-cron.service';
import { UserCredentials } from 'src/users/model/user-credentials.entity';
import { MenuOptionGroup } from './model/menu-option-group.entity';
import { MenuOptionGroupController } from './controllers/menu-option-group.controller';
import { MenuOptionGroupService } from './services/menu-option-group.service';
import { FavoriteStore } from './model/favorite-store.entity';
import { FavoriteStoreService } from './services/favorite-store.service';
import { UserOtpModule } from 'src/user-otp/user-otp.module';
import { StoreMenuImportService } from './services/store-menu-import.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      Stores,
      OpeningSchedule,
      PaymentInfo,
      DaySchedule,
      MenuCategory,
      MenuPack,
      MenuItem,
      AppSetting,
      Analytics,
      UserActivity,
      Users,
      UserCredentials,
      MenuOptionGroup,
      FavoriteStore,
    ]),
    CommonModule,
    UsersModule,
    UserOtpModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '30d' },
    }),
  ],
  controllers: [
    StoresController,
    MenuCategoryController,
    MenuPackController,
    MenuItemController,
    MenuOptionGroupController,
  ],
  providers: [
    StoreService,
    MenuCategoryService,
    MenuPackService,
    MenuItemService,
    S3Service,
    UploadMerchantDocumentsService,
    AnalyticsService,
    MenuDiscountCronService,
    MenuOptionGroupService,
    FavoriteStoreService,
    StoreMenuImportService,
  ],

  exports: [
    MenuItemService,
    StoreService,
    MenuCategoryService,
    MenuPackService,
    MenuOptionGroupService,
  ],
})
export class StoresModule {}

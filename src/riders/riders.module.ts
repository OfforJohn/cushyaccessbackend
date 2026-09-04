import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CqrsModule } from '@nestjs/cqrs';
import { ScheduleModule } from '@nestjs/schedule';

import { Rider } from './model/rider.entity';
import { RiderDocument } from './model/rider-document.entity';
import { RiderLocationHistory } from './model/rider-location-history.entity';

import { TrackingController } from './controllers/tracking.controller';

import { RegisterBikeRiderUseCase } from './usecases/register-bike-rider.usecase';
import { GetRiderProfileUseCase } from './usecases/get-rider-profile.usecase';
import { UpdateRiderStatusUseCase } from './usecases/update-rider-status.usecase';
import { UpdateRiderLocationUseCase } from './usecases/update-rider-location.usecase';
import { ToggleOnlineStatusUseCase } from './usecases/toggle-online-status.usecase';
import { GetRiderStatsUseCase } from './usecases/get-rider-stats.usecase';
import { GetRiderDashboardUseCase } from './usecases/get-rider-dashboard.usecase';
import { GetHotspotsUseCase } from './usecases/get-hotspots.usecase';
import { UpdateRiderBikeUseCase } from './usecases/update-rider-bike.usecase';
import { GetRiderOrderHistoryUseCase } from './usecases/get-rider-order-history.usecase';
import { UploadRiderDocumentsUseCase } from './usecases/upload-rider-documents.usecase';
import { UpdateRiderPayoutScheduleUseCase } from './usecases/update-payout-schedule.usecase';
import { UpdateRiderPayoutDetailsUseCase } from './usecases/update-payout-details.usecase';
import { GetRiderPayoutDetailsUseCase } from './usecases/get-payout-details.usecase';
import { RequestRiderPayoutUseCase } from './usecases/request-payout.usecase';
import { UpdateRiderDocumentsUseCase } from './usecases/update-rider-documents.usecase';
import { Transactions } from '../wallet/model/transaction.entity';

import { LocationTrackingService } from './services/location-tracking.service';
import { RiderGateway } from './gateways/rider.gateway';
import { RiderConnectionService } from './services/rider-connection.service';

import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { CommonModule } from '../common/common.module';
import { UserOtpModule } from '../user-otp/user-otp.module';
import { S3Service } from '../utils/s3-bucket.service';
import { MobileSenderService } from '../user-otp/mobile-sender.service';
import { MailSenderService } from '../user-otp/mail-sender.service';
import { RidersController } from './controllers/riders.controller';
import { RiderService } from './services/riders.service';
import { Orders } from 'src/orders/model/order.entity';
import { OrdersService } from 'src/orders/services/orders.service';
import { AppLevelCharges } from 'src/orders/model/app-level/app-level-charges.entity';
import { Charges } from 'src/orders/model/app-level/charge-entity';
import { OrderTracking } from 'src/orders/model/order-tracking.entity';
import { MenuItemService } from 'src/stores/services/menu-item.service';
import { OrderItems } from 'src/orders/model/order-items.entity';
import { OrderCharges } from 'src/orders/model/charges/order-charges.entity';
import { ChargeNode } from 'src/orders/model/charges/charge-node.entity';
import { OrderUser } from 'src/orders/model/order-user.entity';
import { MenuItem } from 'src/stores/model/menu-item.entity';
import { MenuCategoryService } from 'src/stores/services/menu-category.service';
import { MenuPackService } from 'src/stores/services/menu-pack.service';
import { StoreService } from 'src/stores/services/stores.service';
import { MenuCategory } from 'src/stores/model/menu-category.entity';
import { MenuPack } from 'src/stores/model/menu-pack.entity';
import { Stores } from 'src/stores/model/stores.entity';
import { OpeningSchedule } from 'src/stores/model/opening-schedule.entity';
import { DaySchedule } from 'src/stores/model/day-schedules';
import { PaymentInfo } from 'src/stores/model/payment-info.entity';
import { AppSetting } from 'src/admin/models/app-settings.entity';
import { Users } from 'src/users/model/users.entity';
import { UserCredentials } from 'src/users/model/user-credentials.entity';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { Analytics } from 'src/analytics/entities/analytics.entity';
import { UserActivity } from 'src/analytics/entities/user-activity.entity';
import { OrderModule } from 'src/orders/orders.module';
import { RiderLocationUpdatedHandler } from './handlers/rider-location-updated.handler';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Rider,
      RiderDocument,
      RiderLocationHistory,
      Orders,
      AppLevelCharges,
      Charges,
      OrderTracking,
      OrderItems,
      OrderCharges,
      ChargeNode,
      OrderUser,
      MenuItem,
      MenuCategory,
      MenuPack,
      Stores,
      OpeningSchedule,
      DaySchedule,
      PaymentInfo,
      AppSetting,
      Users,
      UserCredentials,
      Analytics,
      UserActivity,
      Transactions,
    ]),
    CqrsModule,
    ScheduleModule.forRoot(),
    forwardRef(() => UsersModule),
    forwardRef(() => WalletModule),
    forwardRef(() => OrderModule),
    CommonModule,
    UserOtpModule,
  ],
  controllers: [RidersController, TrackingController],
  providers: [
    RegisterBikeRiderUseCase,
    GetRiderProfileUseCase,
    UpdateRiderStatusUseCase,
    UpdateRiderLocationUseCase,
    ToggleOnlineStatusUseCase,
    GetRiderStatsUseCase,
    GetRiderDashboardUseCase,
    GetHotspotsUseCase,
    UpdateRiderBikeUseCase,
    GetRiderOrderHistoryUseCase,
    UploadRiderDocumentsUseCase,
    UpdateRiderPayoutScheduleUseCase,
    UpdateRiderPayoutDetailsUseCase,
    GetRiderPayoutDetailsUseCase,
    RequestRiderPayoutUseCase,
    UpdateRiderDocumentsUseCase,
    RiderService,
    LocationTrackingService,
    RiderConnectionService,
    RiderGateway,
    RiderLocationUpdatedHandler,
    S3Service,
    MobileSenderService,
    AnalyticsService,
  ],
  exports: [
    RegisterBikeRiderUseCase,
    GetRiderProfileUseCase,
    UpdateRiderBikeUseCase,
    GetRiderOrderHistoryUseCase,
    UploadRiderDocumentsUseCase,
    UpdateRiderPayoutScheduleUseCase,
    UpdateRiderPayoutDetailsUseCase,
    GetRiderPayoutDetailsUseCase,
    RequestRiderPayoutUseCase,
    RiderService,
    LocationTrackingService,
    RiderConnectionService,
    RiderGateway,
  ],
})
export class RidersModule {}

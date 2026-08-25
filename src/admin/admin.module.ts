import { Module } from '@nestjs/common';
import { AdminService } from './services/admin.service';
import { AdminController } from './admin.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Orders } from 'src/orders/model/order.entity';
import { OrderStatsUseCase } from './usecases/order-stats.usecase';
import { OrderGraphUseCase } from './usecases/order-graph.usecase';
import { VendorStatsUseCase } from './usecases/vendor-stats.usecase';
import { Users } from 'src/users/model/users.entity';
import { VendorListUseCase } from './usecases/vendor-list.usecase';
import { Wallets } from 'src/wallet/model/wallet.entity';
import { TotalBalanceUseCase } from './usecases/total-balance.usecase';
import { ActiveUsersUseCase } from './usecases/active-users.usecase';
import { Transactions } from 'src/wallet/model/transaction.entity';

import { UserSummariesUseCase } from './usecases/user-summaries.usecase';

import { DailyTransactionPercentageUseCase } from './usecases/daily-transaction-percentage.usecase';
import { UserCountUsecase } from './usecases/total-users.usecase';
import { Rider } from 'src/riders/model/rider.entity';
import { RiderDocument } from 'src/riders/model/rider-document.entity';
import { GetRiderUseCase } from './usecases/get-riders-usecase';
import { AssignRideToOrderUseCase } from './usecases/assign-ride-to-order.usecase';
import { RiderEarningsUseCase } from './usecases/rider-earnings.usecase';
import { UpdateRiderFlagsUseCase } from './usecases/update-rider-flags.usecase';
import { Stores } from 'src/stores/model/stores.entity';
import { UserActivity } from 'src/analytics/entities/user-activity.entity';
import { CqrsModule } from '@nestjs/cqrs';
import { UserCredentials } from 'src/users/model/user-credentials.entity';
import { CreateRiderUseCase } from './usecases/create-rider.usecase';
import { LogisticsOverviewUseCase } from './usecases/logistics-overview.usecase';
import { ReviewRiderDocumentUseCase } from './usecases/review-rider-document.usecase';
import { GetRiderDocumentsUseCase } from './usecases/get-rider-documents.usecase';
import { DeletePlatformAccountUseCase } from './usecases/delete-platform-account.usecase';
import { UsersModule } from 'src/users/users.module';
import { S3Service } from 'src/utils/s3-bucket.service';
import { OrderTracking } from 'src/orders/model/order-tracking.entity';
import { StoresModule } from 'src/stores/stores.module';
import { CommonModule } from 'src/common/common.module';
import { UserOtpModule } from 'src/user-otp/user-otp.module';

@Module({
  imports: [
    CqrsModule,
    UsersModule,
    StoresModule,
    CommonModule,
    UserOtpModule,
    TypeOrmModule.forFeature([
      Orders,
      OrderTracking,
      Users,
      Wallets,
      Rider,
      RiderDocument,
      Stores,
      Transactions,
      UserActivity,
      UserCredentials,
    ]),
  ],
  providers: [
    AdminService,
    OrderStatsUseCase,
    OrderGraphUseCase,
    VendorStatsUseCase,
    VendorListUseCase,

    DailyTransactionPercentageUseCase, // ✅ this needs Transactions repo

    UserCountUsecase,

    TotalBalanceUseCase,

    ActiveUsersUseCase,

    UserSummariesUseCase,
    GetRiderUseCase,
    AssignRideToOrderUseCase,
    RiderEarningsUseCase,
    UpdateRiderFlagsUseCase,
    CreateRiderUseCase,
    LogisticsOverviewUseCase,
    ReviewRiderDocumentUseCase,
    GetRiderDocumentsUseCase,
    DeletePlatformAccountUseCase,
    S3Service,
  ],
  controllers: [
    AdminController,
    // TtrWebhookController,
  ],
})
export class AdminModule {}

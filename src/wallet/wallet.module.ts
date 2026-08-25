import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallets } from './model/wallet.entity';
import { WalletNotifications } from './model/notification.entity';
import { BankAccounts } from './model/bank-account.entity';
import { VirtualAccounts } from './model/virtual-account.entity';
import { CreditCards } from './model/credit-card.entity';
import { CommonModule } from '../common/common.module';
import { TransactionService } from './services/transaction.service';
import { Transactions } from './model/transaction.entity';
import { GetTransactionDetailsUseCase } from './usecases/get-transaction-details.usecase';
import { GetTransactionListUseCase } from './usecases/get-transaction-list.usecase';
import { GetWalletUsecase } from './usecases/get-wallet.usecase';
import { SendFundsUsecase } from './usecases/send-fund.usecase';
import { WalletController } from './wallet.controller';
import { WalletService } from './services/wallet.service';
import { VirtualAccountsService } from './services/virtual-account.service';
import { GetVirtualAccountUseCase } from './usecases/get-virtual-account.usecase';
import { UsersModule } from '../users/users.module';
import { GetRecentTransactUserUseCase } from './usecases/get-recent-transact-users.usecase';
import { GetRecipientUseCase } from './usecases/get-recipient.usecase';
import { WebhookFundWalletUsecase } from './usecases/webhook-fund-wallet.usecase';
import { WebhookController } from './web-hook.controller';
import { PaystackService } from './services/paystack.service';
import { UserOtpModule } from 'src/user-otp/user-otp.module';
import { Users } from 'src/users/model/users.entity';
import { PromoCodeConsumeEventHandler } from './handlers/promo-code-consume-event.handle';
import { ThirdPartyWalletController } from './third-party-wallet.controller';
import { PayoutService } from './services/payout.service';
import { PayoutTransactions } from 'src/users/model/payout-transactions.entity';
import { VendorPayoutDetails } from 'src/users/model/vendor-payout.entity';
import { Orders } from 'src/orders/model/order.entity';
import { ManualFunding } from './model/manual-funding.entity';
import { DoctorPayoutService } from './services/doctor-payout.service';
import { Appointment } from 'src/doctor/models/appointment.entity';
import { GetRiderEarningsOverviewUseCase } from './usecases/get-rider-earnings-overview.usecase';
import { Rider } from '../riders/model/rider.entity';
import { RiderEarningsRecoveryService } from './services/rider-earnings-recovery.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Wallets,
      VirtualAccounts,
      BankAccounts,
      CreditCards,
      WalletNotifications,
      Transactions,
      Users,
      PayoutTransactions,
      VendorPayoutDetails,
      Orders,
      ManualFunding,
      Appointment,
      Rider,
    ]),
    CommonModule,
    UsersModule,
    UserOtpModule,
  ],
  providers: [
    TransactionService,
    WalletService,
    GetVirtualAccountUseCase,
    PaystackService,
    VirtualAccountsService,
    GetTransactionDetailsUseCase,
    GetTransactionListUseCase,
    GetWalletUsecase,
    SendFundsUsecase,
    GetRecipientUseCase,
    GetRecentTransactUserUseCase,
    WebhookFundWalletUsecase,
    PromoCodeConsumeEventHandler,
    PayoutService,
    DoctorPayoutService,
    GetRiderEarningsOverviewUseCase,
    RiderEarningsRecoveryService,
  ],
  controllers: [
    WalletController,
    ThirdPartyWalletController,
    WebhookController,
  ],
  exports: [
    WalletService,
    TransactionService,
    PayoutService,
    PaystackService,
    GetVirtualAccountUseCase,
    RiderEarningsRecoveryService,
  ],
})
export class WalletModule {}

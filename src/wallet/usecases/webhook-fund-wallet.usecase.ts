import { Injectable, NotFoundException } from '@nestjs/common';
import { StandardResponse } from '../../common/module/standard-response';

import { TransactionService } from '../services/transaction.service';
import { WalletService } from '../services/wallet.service';
import { TransactionRequest } from '../model/dto/transaction.request';
import { v4 as uuidv4 } from 'uuid';
import { TransactionCategory } from '../model/transaction-category.enum';
import { TransactionStatus } from '../model/transaction-status.enum';
import { UsersService } from '../../users/services/users.service';
import { WebhookFundWalletDto } from '../model/dto/webhook-fund-wallet.dto';
import { WebHookEvent } from '../model/dto/paystack-response.dto';
import { EventBus } from '@nestjs/cqrs';
import { PushNotificationEvent } from '../../users/events/push-notification.event';
import { UserRoles } from '../../users/model/user-roles.enum';
import { NotificationCategory } from '../../users/model/notification-category';

@Injectable()
export class WebhookFundWalletUsecase {
  constructor(
    private readonly walletService: WalletService,
    private readonly transactionService: TransactionService,
    private readonly userService: UsersService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(
    webhookFundWalletDto: WebhookFundWalletDto,
    event: WebHookEvent,
  ): Promise<StandardResponse> {
    console.log('webhook-fund-wallet-called');
    const user = await this.userService.findByEmailOrMobile(
      webhookFundWalletDto.email,
    );

    if (!user) {
      console.error('user-not-found');
      throw new NotFoundException(new StandardResponse(true, 'USER_NOT_FOUND'));
    }

    const userWallet = await this.walletService.getWallet(user.id);
    if (!userWallet) {
      console.error('wallet-not-initialized');
      throw new NotFoundException(
        new StandardResponse(true, 'USER_WALLET_NOT_INITIALIZED'),
      );
    }

    const newUserBalance =
      userWallet.walletBalance + webhookFundWalletDto.amount;

    userWallet.walletBalance = newUserBalance;
    console.info(`new balance: ${newUserBalance}`);
    await this.walletService.updateWallets([userWallet]);
    const transactionReference = `CATX-${uuidv4()}`;

    const recipientTransaction = new TransactionRequest();
    recipientTransaction.userId = user.id;
    recipientTransaction.walletId = userWallet.id;
    recipientTransaction.metaData = event;

    recipientTransaction.recipientUserId = user.id;
    recipientTransaction.recipientWalletId = userWallet.id;
    recipientTransaction.amount = webhookFundWalletDto.amount;
    recipientTransaction.transactionReference = transactionReference;
    recipientTransaction.description = 'FUND_WALLET';
    recipientTransaction.category = TransactionCategory.FUND_WALLET;
    recipientTransaction.status = TransactionStatus.COMPLETED;
    recipientTransaction.thirdPartyTransactionReference =
      webhookFundWalletDto.reference;

    await this.transactionService.createTransaction(recipientTransaction);

    this.eventBus.publish(
      new PushNotificationEvent(
        user.id,
        user.userRole == UserRoles.VENDOR
          ? NotificationCategory.VENDOR_RECEIVE_FUND_VIA_PAYSTACK_WEBHOOK
          : NotificationCategory.USER_RECEIVE_FUND_VIA_PAYSTACK_WEBHOOK,
        `${event?.data?.authorization?.sender_name ?? ' A friend'}, ${event?.data?.authorization?.sender_bank ?? 'Local Bank'}`,
      ),
    );

    return new StandardResponse(false, 'FUNDED_SUCCESSFULLY', {
      reference: transactionReference,
      amount: webhookFundWalletDto.amount,
      newUserBalance,
    });
  }
}

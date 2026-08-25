import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { PromoCodeConsumeEvent } from '../events/promo-code-consume.event';
import { TransactionRequest } from '../model/dto/transaction.request';
import { TransactionCategory } from '../model/transaction-category.enum';
import { TransactionStatus } from '../model/transaction-status.enum';
import { TransactionService } from '../services/transaction.service';
import { WalletService } from '../services/wallet.service';
import { v4 as uuidv4 } from 'uuid';

@EventsHandler(PromoCodeConsumeEvent)
export class PromoCodeConsumeEventHandler
  implements IEventHandler<PromoCodeConsumeEvent>
{
  constructor(
    private readonly walletService: WalletService,
    private readonly transactionsService: TransactionService,
  ) {}
  async handle(promoCodeConsumeEvent: PromoCodeConsumeEvent) {
    const { promoCode, userId } = promoCodeConsumeEvent;
    const consumersWallet = await this.walletService.getWallet(userId);
    const ambassadorsWallet = await this.walletService.getWallet(userId);
    consumersWallet.walletBalance += promoCode.consumersReward;
    ambassadorsWallet.walletBalance += promoCode.ambassadorsReward;
    await this.walletService.updateWallets([
      consumersWallet,
      ambassadorsWallet,
    ]);

    const transactionReference = `CATX-${uuidv4()}`;

    const consumersTransaction = new TransactionRequest();
    consumersTransaction.userId = userId;
    consumersTransaction.walletId = consumersWallet.id;

    consumersTransaction.recipientUserId = userId;
    consumersTransaction.recipientWalletId = consumersWallet.id;

    consumersTransaction.amount = promoCode.consumersReward;
    consumersTransaction.transactionReference = transactionReference;
    consumersTransaction.description = 'PROMO_CODE_REWARD';
    consumersTransaction.category = TransactionCategory.CREDIT;
    consumersTransaction.status = TransactionStatus.COMPLETED;
    consumersTransaction.orderId = promoCodeConsumeEvent.orderId;
    //TODO: add money to users wallet
    // TODO: add money ambassador's wallet

    const ambassadorTransaction = new TransactionRequest();
    ambassadorTransaction.userId = promoCode.ambassadorId;
    ambassadorTransaction.walletId = ambassadorsWallet.id;

    ambassadorTransaction.recipientUserId = promoCode.ambassadorId;
    ambassadorTransaction.recipientWalletId = ambassadorsWallet.id;

    ambassadorTransaction.amount = promoCode.ambassadorsReward;
    ambassadorTransaction.transactionReference = transactionReference;
    ambassadorTransaction.description = 'PROMO_CODE_AFFILATE_REWARD';
    ambassadorTransaction.orderId = promoCodeConsumeEvent.orderId;
    ambassadorTransaction.category = TransactionCategory.CREDIT;
    ambassadorTransaction.status = TransactionStatus.COMPLETED;

    await this.transactionsService.createTransaction(consumersTransaction);
    await this.transactionsService.createTransaction(ambassadorTransaction);
  }
}

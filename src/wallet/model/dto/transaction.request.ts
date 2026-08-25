import { TransactionCategory } from '../transaction-category.enum';
import { TransactionStatus } from '../transaction-status.enum';
import { WebHookEvent } from './paystack-response.dto';

export class TransactionRequest {
  userId: string;
  walletId: string;
  amount: number;
  transactionReference: string;
  thirdPartyTransactionReference: string;
  description: string;
  category: TransactionCategory;
  status: TransactionStatus;
  senderUserId: string;
  senderWalletId: string;
  recipientUserId: string;
  recipientWalletId: string;
  metaData: WebHookEvent;
  orderId: string;
}

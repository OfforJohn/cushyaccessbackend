import { TransactionCategory } from '../transaction-category.enum';
import { TransactionStatus } from '../transaction-status.enum';

export class TransactionDetails {
  constructor(
    private readonly id: string,
    private readonly transactionReference: string,
    private readonly status: TransactionStatus,
    private readonly recipientUserId: string,
    private readonly recipientFirstName: string,
    private readonly recipientLastName: string,
    private readonly receiptEmail: string,
    private readonly senderFirstName: string,
    private readonly senderLastName: string,
    private readonly senderEmail: string,
    private readonly transactionAmount: number,
    private readonly category: TransactionCategory,
    private readonly description: string,
    private readonly createAt: Date,
    private readonly updatedAt: Date,
    private readonly thirpartySenderInfo: ThirdPartySenderInfo,
  ) {}
}

export class ThirdPartySenderInfo {
  accountNumber: string;
  bankName: string;
  sendersName: string;
}

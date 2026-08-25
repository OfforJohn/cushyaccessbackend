import { TransactionDto } from './transaction.dto';

export class WalletDto {
  id: string;
  accountBalance: number;
  hasSetPin: boolean;
  lastTwoTransactions: TransactionDto[];
}

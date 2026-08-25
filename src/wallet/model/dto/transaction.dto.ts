import { TransactionCategory } from '../transaction-category.enum';
import { TransactionStatus } from '../transaction-status.enum';

export class TransactionDto {
  constructor(
    private readonly id: string,
    private readonly amount: number,
    private readonly type: TransactionCategory,
    private readonly date: Date,
    private readonly status: TransactionStatus,
    private readonly orderId: string,
  ) {}
}

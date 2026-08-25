import { Injectable } from '@nestjs/common';
import { TransactionService } from '../services/transaction.service';
import { StandardResponse } from '../../common/module/standard-response';

@Injectable()
export class GetRecentTransactUserUseCase {
  constructor(private readonly transactionService: TransactionService) {}

  async execute(query: string) {
    const users =
      await this.transactionService.getRecentTransactUsersViaQuery(query);

    return new StandardResponse(false, 'RECENT_TRANSACTIONS_FETCHED', users);
  }
}

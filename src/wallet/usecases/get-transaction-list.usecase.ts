import { CommonService } from 'src/common/common.service';
import { PaginationRequest } from '../../common/module/pagination-request';
import { StandardResponse } from '../../common/module/standard-response';
import { TransactionService } from '../services/transaction.service';
import { WalletMapper } from '../services/wallet.mapper';
import { Injectable } from '@nestjs/common';
import { RiderEarningsRecoveryService } from '../services/rider-earnings-recovery.service';

@Injectable()
export class GetTransactionListUseCase {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly commonService: CommonService,
    private readonly riderEarningsRecoveryService: RiderEarningsRecoveryService,
  ) {}
  async execute(paginationRequest: PaginationRequest) {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    await this.riderEarningsRecoveryService.reconcileForUser(
      authenticatedUser.id,
    );
    const [transactions, total] =
      await this.transactionService.getUserTransactions(
        authenticatedUser.id,
        paginationRequest,
      );
    const transactionDtos = WalletMapper.mapTransactionList(transactions);
    return StandardResponse.withPagination(
      'TRANSACTION_FETCHED_SUCCESSFULLY',
      transactionDtos,
      paginationRequest,
      total,
    );
  }
}

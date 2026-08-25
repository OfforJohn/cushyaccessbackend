import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TransactionService } from '../services/transaction.service';
import { StandardResponse } from 'src/common/module/standard-response';
import { WalletMapper } from '../services/wallet.mapper';
import { CommonService } from '../../common/common.service';

@Injectable()
export class GetTransactionDetailsUseCase {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly commonService: CommonService,
  ) {}

  async execute(transactionIdOrReference: string) {
    const transaction = await this.transactionService.getTransaction(
      transactionIdOrReference,
    );
    if (!transaction) {
      throw new NotFoundException(
        new StandardResponse(true, 'TRANSACTION_NOT_FOUND'),
      );
    }
    const authenticatedUser = await this.commonService.getLoggedInUser();
    if (transaction.userId !== authenticatedUser.id) {
      throw new ForbiddenException(
        new StandardResponse(true, 'UNAUTHORIZED_TRANSACTION_ACCESS'),
      );
    }

    return new StandardResponse(
      false,
      'TRANSACTION_FETCHED_SUCCESSFULLY',
      WalletMapper.mapTransactionDetails(transaction),
    );
  }
}

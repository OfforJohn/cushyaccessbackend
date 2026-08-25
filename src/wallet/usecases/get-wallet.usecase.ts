import { Injectable } from '@nestjs/common';
import { TransactionService } from '../services/transaction.service';
import { WalletMapper } from '../services/wallet.mapper';
import { WalletService } from '../services/wallet.service';
import { CommonService } from 'src/common/common.service';
import { StandardResponse } from 'src/common/module/standard-response';
import { RiderEarningsRecoveryService } from '../services/rider-earnings-recovery.service';

@Injectable()
export class GetWalletUsecase {
  constructor(
    private readonly walletService: WalletService,
    private readonly transactionService: TransactionService,
    private readonly commonService: CommonService,
    private readonly riderEarningsRecoveryService: RiderEarningsRecoveryService,
  ) {}

  async execute(): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const userId = authenticatedUser.id;
    let wallet = await this.walletService.getWallet(userId);
    if (!wallet) {
      // Create the Cushcoin wallet immediately. A dedicated bank account is
      // provisioned only when the user opens Add Money, which avoids external
      // calls and allocation before the user requests bank-transfer funding.
      wallet = await this.walletService.createWallet();
    }
    await this.riderEarningsRecoveryService.reconcileForUser(userId);
    wallet = (await this.walletService.getWallet(userId)) || wallet;
    const transactions =
      await this.transactionService.getLastTransctionsWithLimit(userId, 2);
    return new StandardResponse(
      false,
      'WALLET_FETCHED_SUCCESSFULLY',
      WalletMapper.toDto(wallet, transactions),
    );
  }
}

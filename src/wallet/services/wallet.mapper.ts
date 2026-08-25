import { TransactionDto } from '../model/dto/transaction.dto';
import { WalletDto } from '../model/dto/wallet.dto';
import { Transactions } from '../model/transaction.entity';
import { Wallets } from '../model/wallet.entity';
import {
  ThirdPartySenderInfo,
  TransactionDetails,
} from '../model/dto/transaction-list.dto';
import { VirtualAccounts } from '../model/virtual-account.entity';
import { VirtualAccountDto } from '../model/dto/virtual-account.dto';
import { Users } from '../../users/model/users.entity';
import { RecipientUserDto } from '../model/dto/receipt-user.dto';

export class WalletMapper {
  static toDto(wallet: Wallets, transactions?: Transactions[]): WalletDto {
    const lastTwoTransactions = transactions || [];
    return {
      id: wallet.id,
      accountBalance: wallet.walletBalance,
      hasSetPin: wallet.hasSetPin,
      lastTwoTransactions: lastTwoTransactions.map(this.mapTransaction),
    };
  }

  static mapTransaction(transaction: Transactions): TransactionDto {
    return new TransactionDto(
      transaction.id,
      transaction.amount,
      transaction.category,
      transaction.createdAt,
      transaction.status,
      transaction.orderId,
    );
  }

  static mapTransactionList(transactions: Transactions[]): TransactionDto[] {
    return transactions.map(this.mapTransaction);
  }

  static mapTransactionDetails(transaction: Transactions): TransactionDetails {
    const thirdPartySenderInfo = new ThirdPartySenderInfo();
    if (transaction.metaData) {
      const metdaData = transaction.metaData;
      thirdPartySenderInfo.accountNumber =
        metdaData?.data?.authorization?.sender_bank_account_number;
      thirdPartySenderInfo.bankName =
        metdaData?.data?.authorization?.sender_bank;
      thirdPartySenderInfo.sendersName =
        metdaData?.data?.authorization?.sender_name;
    }
    return new TransactionDetails(
      transaction.id,
      transaction.transactionReference,
      transaction.status,
      transaction.receipientUserId,
      transaction.receipientUser?.firstName,
      transaction.receipientUser?.lastName,
      transaction.receipientUser?.email,
      transaction.senderUser?.firstName, // senderUser maybe null
      transaction.senderUser?.lastName,
      transaction.senderUser?.email,
      transaction.amount,
      transaction.category,
      transaction.description,
      transaction.createdAt,
      transaction.updatedAt,
      thirdPartySenderInfo,
    );
  }

  static mapAccount(virtualAccount: VirtualAccounts) {
    return new VirtualAccountDto(
      virtualAccount.id,
      virtualAccount.accountName,
      virtualAccount.accountNumber,
      virtualAccount.bank,
      virtualAccount.createdAt,
      virtualAccount.updatedAt,
    );
  }

  mapToRecipient(user: Users) {
    const recipientDto = new RecipientUserDto();
    recipientDto.id = user.id;
    recipientDto.fullName = `${user.lastName} ${user.firstName}`;
    recipientDto.email = user.email;

    return recipientDto;
  }

  mapToRecipientList(users: Users[]) {
    return users?.map((user) => this.mapToRecipient(user));
  }
}

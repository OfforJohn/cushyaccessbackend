import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Transactions } from '../model/transaction.entity';
import { TransactionRequest } from '../model/dto/transaction.request';
import { Injectable } from '@nestjs/common';
import { PaginationRequest } from '../../common/module/pagination-request';
import { CommonService } from '../../common/common.service';
import { TransactionStatus } from '../model/transaction-status.enum';

@Injectable()
export class TransactionService {
  constructor(
    @InjectRepository(Transactions)
    private readonly transactionRepository: Repository<Transactions>,
    private readonly commonService: CommonService,
  ) { }

  async createTransaction(
    transactionRequest: TransactionRequest,
    manager?: EntityManager, // optional
  ): Promise<Transactions> {
    const transaction = new Transactions();
    transaction.amount = transactionRequest.amount;
    transaction.category = transactionRequest.category;
    transaction.status = transactionRequest.status;
    transaction.walletId = transactionRequest.walletId;
    transaction.description = transactionRequest.description;
    transaction.transactionReference = transactionRequest.transactionReference;
    transaction.userId = transactionRequest.userId;
    transaction.orderId = transactionRequest.orderId;
    transaction.receipientUserId = transactionRequest.recipientUserId;
    transaction.receipientWalletId = transactionRequest.recipientWalletId;
    transaction.senderUserId = transactionRequest.senderUserId;
    transaction.senderWalletId = transactionRequest.senderWalletId;
    transaction.metaData = transactionRequest.metaData;
    transaction.thirdPartyTransactionReference = transactionRequest.thirdPartyTransactionReference;

    if (manager) {
      return await manager.save(Transactions, transaction);
    } else {
      return await this.transactionRepository.save(transaction);
    }
  }

  async getLastTransctionsWithLimit(
    userId: string,
    limit: number,
  ): Promise<Transactions[]> {
    return await this.transactionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getUserTransactions(
    userId: string,
    paginationRequest?: PaginationRequest,
  ): Promise<[Transactions[], number]> {
    const transactionQuery = this.transactionRepository
      .createQueryBuilder('t') // 👈 Explicit alias for Transactions
      .where('t.userId = :userId', { userId });

    if (paginationRequest?.filter?.category) {
      transactionQuery.andWhere('t.category = :category', {
        category: paginationRequest.filter.category,
      });
    }

    if (paginationRequest?.filter?.status) {
      transactionQuery.andWhere('t.status = :status', {
        status: paginationRequest.filter.status,
      });
    }

    if (paginationRequest.sortBy && paginationRequest.sortOrder) {
      transactionQuery.orderBy(
        `t.${paginationRequest.sortBy}`,
        paginationRequest.sortOrder,
      );
    }

    if (paginationRequest.page && paginationRequest.size) {
      transactionQuery
        .skip((paginationRequest.page - 1) * paginationRequest.size)
        .take(paginationRequest.size);
    }

    return await transactionQuery.getManyAndCount();
  }

  async getTransaction(
    transactionIdOrReference: string,
  ): Promise<Transactions> {
    return await this.transactionRepository.findOne({
      where: [
        { id: transactionIdOrReference },
        { transactionReference: transactionIdOrReference },
      ],
      relations: ['receipientUser', 'senderUser', 'user'],
    });
  }

  async getRecentTransactUsersViaQuery(query: string) {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const transactionQuery = this.transactionRepository
      .createQueryBuilder('trn')
      .leftJoin('trn.receipientUser', 'ru')
      .where('ru.id != :id', { id: authenticatedUser.id });

    if (query) {
      transactionQuery.andWhere('ru.email LIKE :query', {
        query: `%${query}%`,
      });
    }

    return transactionQuery
      .select([
        'ru.id AS userId',
        'ru.email AS email',
        'ru.lastName AS lastName',
        'ru.firstName AS firstName',
        'MAX(trn.updatedAt) AS updatedAt',
      ])
      .groupBy('ru.id')
      .orderBy('updatedAt', 'DESC')
      .take(10)
      .getRawMany();
  }

  async getAwaitingTransaction(orderId: string): Promise<Transactions> {
    return await this.transactionRepository.findOne({
      where: { orderId, status: TransactionStatus.AWAITING_DELIVERY },
    });
  }
  async saveTransaction(transaction: Transactions) {
    return await this.transactionRepository.save(transaction);
  }
  async getAllTransactions() {
    return await this.transactionRepository.find({
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }
}

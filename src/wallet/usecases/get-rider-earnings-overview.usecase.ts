import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommonService } from '../../common/common.service';
import { StandardResponse } from '../../common/module/standard-response';
import { RIDER_NET_PAYOUT_RATE } from '../../riders/rider-commission';
import { TransactionCategory } from '../model/transaction-category.enum';
import { Transactions } from '../model/transaction.entity';
import { TransactionStatus } from '../model/transaction-status.enum';
import { Wallets } from '../model/wallet.entity';
import { RiderEarningsRecoveryService } from '../services/rider-earnings-recovery.service';
import moment from 'moment-timezone';

type EarningsPeriod = {
  gross: number;
  commission: number;
  amount: number;
};

const emptyPeriod = (): EarningsPeriod => ({
  gross: 0,
  commission: 0,
  amount: 0,
});

const round = (value: number) => Number(value.toFixed(2));

@Injectable()
export class GetRiderEarningsOverviewUseCase {
  constructor(
    @InjectRepository(Transactions)
    private readonly transactionsRepository: Repository<Transactions>,
    @InjectRepository(Wallets)
    private readonly walletRepository: Repository<Wallets>,
    private readonly commonService: CommonService,
    private readonly riderEarningsRecoveryService: RiderEarningsRecoveryService,
  ) {}

  async execute(): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    let wallet = await this.walletRepository.findOne({
      where: { userId: authenticatedUser.id },
    });
    if (!wallet) {
      throw new NotFoundException(
        new StandardResponse(true, 'WALLET_NOT_FOUND'),
      );
    }
    await this.riderEarningsRecoveryService.reconcileForUser(
      authenticatedUser.id,
    );
    wallet =
      (await this.walletRepository.findOne({
        where: { userId: authenticatedUser.id },
      })) || wallet;

    const lagosNow = moment.tz('Africa/Lagos');
    const startOfToday = lagosNow.clone().startOf('day').toDate();
    const startOfWeek = lagosNow.clone().startOf('week').toDate();
    const startOfMonth = lagosNow.clone().startOf('month').toDate();

    const earnings = await this.transactionsRepository
      .createQueryBuilder('transaction')
      .where('transaction.userId = :userId', { userId: authenticatedUser.id })
      .andWhere('transaction.category = :category', {
        category: TransactionCategory.CREDIT,
      })
      .andWhere('transaction.status = :status', {
        status: TransactionStatus.COMPLETED,
      })
      .andWhere('transaction.orderId IS NOT NULL')
      .andWhere('transaction.createdAt >= :startOfMonth', { startOfMonth })
      .andWhere(
        '(transaction.transactionReference LIKE :currentReference OR transaction.transactionReference LIKE :legacyReference)',
        {
          currentReference: 'rider_earning_%',
          legacyReference: 'rider_payout_%',
        },
      )
      .orderBy('transaction.createdAt', 'DESC')
      .getMany();

    const today = emptyPeriod();
    const thisWeek = emptyPeriod();
    const thisMonth = emptyPeriod();
    const trips = new Map<string, { count: number; amount: number }>();

    for (const earning of earnings) {
      const meta = (earning.metaData || {}) as unknown as Record<
        string,
        unknown
      >;
      const net = Number(earning.amount || 0);
      const grossFromMetadata = Number(meta.grossDeliveryFee);
      const gross = Number.isFinite(grossFromMetadata)
        ? grossFromMetadata
        : net / RIDER_NET_PAYOUT_RATE;
      const commissionFromMetadata = Number(meta.platformCommission);
      const commission = Number.isFinite(commissionFromMetadata)
        ? commissionFromMetadata
        : gross - net;

      this.addToPeriod(thisMonth, gross, commission, net);
      if (earning.createdAt >= startOfWeek) {
        this.addToPeriod(thisWeek, gross, commission, net);
      }
      if (earning.createdAt >= startOfToday) {
        this.addToPeriod(today, gross, commission, net);
      }

      const orderType = String(meta.orderType || 'DELIVERY').toUpperCase();
      const trip = trips.get(orderType) || { count: 0, amount: 0 };
      trip.count += 1;
      trip.amount += net;
      trips.set(orderType, trip);
    }

    const nextPayout = new Date();
    nextPayout.setDate(
      nextPayout.getDate() + ((1 + 7 - nextPayout.getDay()) % 7 || 7),
    );
    nextPayout.setHours(9, 0, 0, 0);

    return new StandardResponse(false, 'EARNINGS_OVERVIEW_FETCHED', {
      availableBalance: Number(wallet.walletBalance || 0),
      today: this.roundPeriod(today),
      thisWeek: this.roundPeriod(thisWeek),
      thisMonth: this.roundPeriod(thisMonth),
      commissionPolicy: {
        platformCommissionRate: 20,
        riderNetRate: 80,
      },
      tripBreakdown: Array.from(trips.entries()).map(([type, trip]) => ({
        type: this.formatOrderType(type),
        count: trip.count,
        amount: round(trip.amount),
        icon: 'bike-fast',
        color: '#4E1E58',
      })),
      bonuses: [],
      nextPayoutSchedule: nextPayout,
    });
  }

  private addToPeriod(
    period: EarningsPeriod,
    gross: number,
    commission: number,
    net: number,
  ) {
    period.gross += gross;
    period.commission += commission;
    period.amount += net;
  }

  private roundPeriod(period: EarningsPeriod): EarningsPeriod {
    return {
      gross: round(period.gross),
      commission: round(period.commission),
      amount: round(period.amount),
    };
  }

  private formatOrderType(type: string) {
    if (type === 'Q_COMMERCE') return 'Q-Commerce';
    if (type === 'LOGISTICS') return 'Logistics';
    return 'Delivery';
  }
}

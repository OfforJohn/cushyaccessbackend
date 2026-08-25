import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rider } from '../model/rider.entity';
import { Orders } from '../../orders/model/order.entity';
import { OrderStatus } from '../../orders/model/enum/order-status.enum';
import { Transactions } from '../../wallet/model/transaction.entity';
import { TransactionStatus } from '../../wallet/model/transaction-status.enum';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { RiderDashboardDto } from '../dto/rider-dashboard.dto';
import { RiderEarningsRecoveryService } from '../../wallet/services/rider-earnings-recovery.service';
import moment from 'moment-timezone';

@Injectable()
export class GetRiderDashboardUseCase {
  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    @InjectRepository(Orders)
    private readonly ordersRepository: Repository<Orders>,
    @InjectRepository(Transactions)
    private readonly transactionsRepository: Repository<Transactions>,
    private readonly commonService: CommonService,
    private readonly riderEarningsRecoveryService: RiderEarningsRecoveryService,
  ) {}

  async execute(): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();

    const rider = await this.riderRepository.findOne({
      where: { userId: authenticatedUser.id },
    });

    if (!rider) {
      throw new NotFoundException(
        new StandardResponse(true, 'RIDER_NOT_FOUND'),
      );
    }

    await this.riderEarningsRecoveryService.reconcileForUser(
      authenticatedUser.id,
    );

    const lagosNow = moment.tz('Africa/Lagos');
    const startOfDay = lagosNow.clone().startOf('day').toDate();
    const endOfDay = lagosNow.clone().endOf('day').toDate();

    // 1. Calculate Today's Earnings
    const todayTransactions = await this.transactionsRepository
      .createQueryBuilder('walletTransaction')
      .where('walletTransaction.userId = :userId', {
        userId: authenticatedUser.id,
      })
      .andWhere('walletTransaction.status = :status', {
        status: TransactionStatus.COMPLETED,
      })
      .andWhere(
        'walletTransaction.createdAt BETWEEN :startOfDay AND :endOfDay',
        {
          startOfDay,
          endOfDay,
        },
      )
      .andWhere(
        '(walletTransaction.transactionReference LIKE :riderEarning OR walletTransaction.transactionReference LIKE :riderPayout)',
        {
          riderEarning: 'rider_earning_%',
          riderPayout: 'rider_payout_%',
        },
      )
      .getMany();

    const todayEarnings = Number(
      todayTransactions
        .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0)
        .toFixed(2),
    );

    // Keep every order-derived dashboard figure in one indexed query. A
    // legacy delivered order may not have deliveredAt, so use updatedAt as a
    // safe fallback for the "today" count.
    const orderStats = await this.ordersRepository
      .createQueryBuilder('order')
      .select(
        `COUNT(*) FILTER (
          WHERE order.status = :deliveredStatus
          AND COALESCE(order.deliveredAt, order.updatedAt, order.createdAt)
            BETWEEN :startOfDay AND :endOfDay
        )`,
        'tripsDone',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE order.status = :deliveredStatus)',
        'completedOrders',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE order.status IN (:...activeStatuses))',
        'pendingOrders',
      )
      .addSelect('COUNT(*)', 'assignedOrders')
      .where('order.riderId = :riderId', { riderId: rider.id })
      .setParameters({
        deliveredStatus: OrderStatus.delivered,
        activeStatuses: [
          OrderStatus.pending,
          OrderStatus.acknoledged,
          OrderStatus.picked_up,
          OrderStatus.in_transit,
        ],
        startOfDay,
        endOfDay,
      })
      .getRawOne<{
        tripsDone?: string;
        completedOrders?: string;
        pendingOrders?: string;
        assignedOrders?: string;
      }>();
    const tripsDone = Number(orderStats?.tripsDone || 0);
    const pendingOrders = Number(orderStats?.pendingOrders || 0);
    const completedOrders = Number(orderStats?.completedOrders || 0);
    const assignedOrders = Number(orderStats?.assignedOrders || 0);
    const completionRate = assignedOrders
      ? Math.round((completedOrders / assignedOrders) * 100)
      : 100;

    const dashboardData: RiderDashboardDto = {
      isOnline: rider.isOnline,
      todayEarnings,
      tripsDone,
      onlineTime: Number(rider.onlineHours || 0),
      completionRate,
      rating: Number(rider.rating || 5.0),
      pendingOrders,
      activeCategories: rider.activeCategories || [
        'food',
        'grocery',
        'medicine',
      ],
    };

    return new StandardResponse(false, 'DASHBOARD_DATA_FETCHED', dashboardData);
  }
}

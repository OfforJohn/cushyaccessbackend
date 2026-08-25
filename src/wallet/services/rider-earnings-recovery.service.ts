import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { calculateRiderCommission } from '../../riders/rider-commission';
import { Rider } from '../../riders/model/rider.entity';
import { OrderStatus } from '../../orders/model/enum/order-status.enum';
import { Orders } from '../../orders/model/order.entity';
import { TransactionCategory } from '../model/transaction-category.enum';
import { Transactions } from '../model/transaction.entity';
import { TransactionStatus } from '../model/transaction-status.enum';
import { Wallets } from '../model/wallet.entity';

const RECOVERY_BATCH_SIZE = 25;

/**
 * Repairs deliveries that reached DELIVERED before a rider earning was
 * recorded. Each order row is locked and its stable transaction reference is
 * checked inside the same transaction, so repeated wallet/dashboard reads
 * cannot credit a rider twice.
 */
@Injectable()
export class RiderEarningsRecoveryService {
  private readonly logger = new Logger(RiderEarningsRecoveryService.name);
  private readonly inFlight = new Map<string, Promise<number>>();

  constructor(private readonly dataSource: DataSource) {}

  async reconcileForUser(userId: string): Promise<number> {
    const existing = this.inFlight.get(userId);
    if (existing) return existing;

    const reconciliation = this.reconcile(userId).finally(() => {
      if (this.inFlight.get(userId) === reconciliation) {
        this.inFlight.delete(userId);
      }
    });
    this.inFlight.set(userId, reconciliation);
    return reconciliation;
  }

  private async reconcile(userId: string): Promise<number> {
    try {
      const rider = await this.dataSource.getRepository(Rider).findOne({
        where: { userId },
      });
      if (!rider) return 0;

      const orders = await this.dataSource
        .getRepository(Orders)
        .createQueryBuilder('order')
        .leftJoin(
          Transactions,
          'earning',
          "earning.orderId = order.id AND (earning.transactionReference = CONCAT('rider_earning_', order.id) OR earning.transactionReference = CONCAT('rider_payout_', order.id))",
        )
        .innerJoin('order.orderCharges', 'orderCharges')
        .innerJoin(
          'orderCharges.chargeNodes',
          'deliveryCharge',
          'deliveryCharge.name = :deliveryFeeName AND deliveryCharge.amount > 0',
          { deliveryFeeName: 'deliveryFee' },
        )
        .where('order.riderId = :riderId', { riderId: rider.id })
        .andWhere('order.status = :status', {
          status: OrderStatus.delivered,
        })
        .andWhere('earning.id IS NULL')
        .orderBy('order.deliveredAt', 'DESC')
        .take(RECOVERY_BATCH_SIZE)
        .getMany();

      let recovered = 0;
      for (const order of orders) {
        try {
          recovered += await this.reconcileOrder(order.id, rider.id);
        } catch (error) {
          this.logger.error(
            `Unable to reconcile rider earnings for delivered order ${order.id}.`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
      return recovered;
    } catch (error) {
      this.logger.error(
        `Unable to identify missed rider earnings for user ${userId}.`,
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    }
  }

  private async reconcileOrder(orderId: string, riderId: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const lockedOrder = await manager.findOne(Orders, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !lockedOrder ||
        lockedOrder.riderId !== riderId ||
        lockedOrder.status !== OrderStatus.delivered
      ) {
        return 0;
      }

      const order = await manager.findOne(Orders, {
        where: { id: orderId },
        relations: ['orderCharges', 'orderCharges.chargeNodes'],
      });
      if (!order) return 0;

      const reference = `rider_earning_${order.id}`;
      const existingEarning = await manager.findOne(Transactions, {
        where: {
          transactionReference: In([
            reference,
            `rider_payout_${order.id}`,
          ]),
        },
      });
      if (existingEarning) return 0;

      const deliveryFee = Number(
        order.orderCharges?.chargeNodes?.find(
          (node) => node.name === 'deliveryFee',
        )?.amount || 0,
      );
      const commission = calculateRiderCommission(deliveryFee);
      if (commission.grossDeliveryFee <= 0) {
        this.logger.warn(
          `Delivered order ${order.id} has no delivery-fee charge to recover.`,
        );
        return 0;
      }

      const rider = await manager.findOne(Rider, {
        where: { id: riderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!rider) return 0;

      const wallet = await this.getLockedWallet(manager, rider.userId);
      // A first-time wallet is created through GetWalletUsecase so virtual
      // account provisioning is not bypassed here.
      if (!wallet) return 0;

      wallet.walletBalance =
        Number(wallet.walletBalance) + commission.netRiderPayout;
      await manager.save(Wallets, wallet);

      await manager.save(
        Transactions,
        manager.create(Transactions, {
          amount: commission.netRiderPayout,
          category: TransactionCategory.CREDIT,
          status: TransactionStatus.COMPLETED,
          walletId: wallet.id,
          userId: rider.userId,
          orderId: order.id,
          transactionReference: reference,
          receipientUserId: rider.userId,
          receipientWalletId: wallet.id,
          description: `Recovered delivery earnings for order #${order.id}: gross NGN ${commission.grossDeliveryFee.toFixed(2)}, 20% commission NGN ${commission.platformCommission.toFixed(2)}, net NGN ${commission.netRiderPayout.toFixed(2)}`,
          metaData: {
            grossDeliveryFee: commission.grossDeliveryFee,
            platformCommissionRate: commission.platformCommissionRate,
            platformCommission: commission.platformCommission,
            netRiderPayout: commission.netRiderPayout,
            orderType: order.type,
            recovered: true,
          } as never,
        }),
      );

      rider.totalDeliveries = Number(rider.totalDeliveries || 0) + 1;
      rider.totalEarnings =
        Number(rider.totalEarnings || 0) + commission.netRiderPayout;
      await manager.save(Rider, rider);

      return commission.netRiderPayout;
    });
  }

  private getLockedWallet(manager: EntityManager, userId: string) {
    return manager.findOne(Wallets, {
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { DataSource, EntityManager } from 'typeorm';
import { StandardResponse } from '../../common/module/standard-response';
import { NotificationCategory } from '../../users/model/notification-category';
import { PushNotificationEvent } from '../../users/events/push-notification.event';
import { TransactionCategory } from '../../wallet/model/transaction-category.enum';
import { Transactions } from '../../wallet/model/transaction.entity';
import { TransactionStatus } from '../../wallet/model/transaction-status.enum';
import { Wallets } from '../../wallet/model/wallet.entity';
import { OrderStatus } from '../model/enum/order-status.enum';
import { Orders } from '../model/order.entity';
import { OrderTracking } from '../model/order-tracking.entity';
import { RiderOrderDispatchService } from '../services/rider-order-dispatch.service';

type VendorDecision = {
  order: Orders;
  changed: boolean;
};

@Injectable()
export class VendorAcceptRejectOrderUseCase {
  private readonly logger = new Logger(VendorAcceptRejectOrderUseCase.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly eventBus: EventBus,
    private readonly riderOrderDispatchService: RiderOrderDispatchService,
  ) {}

  async execute(status: OrderStatus, orderId: string, vendorUserId: string) {
    if (status !== OrderStatus.acknoledged && status !== OrderStatus.rejected) {
      throw new BadRequestException('INVALID_VENDOR_ORDER_STATUS');
    }

    const decision = await this.dataSource.transaction((manager) =>
      this.applyDecision(manager, orderId, status, vendorUserId),
    );
    if (decision.changed) {
      this.eventBus.publish(
        new PushNotificationEvent(
          decision.order.userId,
          status === OrderStatus.acknoledged
            ? NotificationCategory.VENDOR_ACCEPT_ORDER
            : NotificationCategory.VENDOR_REJECT_ORDER,
        ),
      );
    }

    if (status === OrderStatus.acknoledged) {
      try {
        await this.riderOrderDispatchService.dispatch(decision.order);
      } catch (error) {
        this.logger.error(
          `Order ${orderId} was acknowledged, but rider dispatch failed.`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    if (!decision.changed) {
      return new StandardResponse(false, 'ORDER_STATUS_ALREADY_APPLIED');
    }

    return new StandardResponse(false, 'ORDER_STATUS_UPDATED');
  }

  private async applyDecision(
    manager: EntityManager,
    orderId: string,
    status: OrderStatus,
    vendorUserId: string,
  ): Promise<VendorDecision> {
    const lockedOrder = await manager.findOne(Orders, {
      where: { id: orderId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!lockedOrder) throw new NotFoundException('ORDER_NOT_FOUND');

    const order = await manager.findOne(Orders, {
      where: { id: orderId },
      relations: [
        'orderTracking',
        'store',
        'orderItems',
        'pickUpLocation',
        'dropOffLocation',
        'senderInfo',
        'recipientInfo',
        'orderCharges',
        'orderCharges.chargeNodes',
      ],
    });
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND');
    if (!order.store || order.store.userId !== vendorUserId) {
      throw new ForbiddenException('ORDER_DOES_NOT_BELONG_TO_VENDOR');
    }

    const latest = [...(order.orderTracking || [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
    if (latest?.orderStatus === status) return { order, changed: false };
    if (
      order.status === OrderStatus.delivered ||
      order.status === OrderStatus.cancelled ||
      order.status === OrderStatus.rejected
    ) {
      throw new BadRequestException('ORDER_ALREADY_FINALIZED');
    }
    if (order.riderId) {
      throw new BadRequestException('ORDER_ALREADY_ASSIGNED_TO_RIDER');
    }

    if (status === OrderStatus.rejected) {
      await this.refundCustomer(manager, order);
      order.status = OrderStatus.rejected;
      order.rejectedAt = new Date();
      await manager.save(Orders, order);
    }

    await manager.save(
      OrderTracking,
      manager.create(OrderTracking, {
        order,
        orderId: order.id,
        orderStatus: status,
      }),
    );
    return { order, changed: true };
  }

  private async refundCustomer(manager: EntityManager, order: Orders) {
    if (!order.userId) return;
    const reference = `order_refund_${order.id}`;
    const existing = await manager.findOne(Transactions, {
      where: { transactionReference: reference },
    });
    if (existing) return;

    let wallet = await manager.findOne(Wallets, {
      where: { userId: order.userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!wallet) {
      wallet = await manager.save(
        Wallets,
        manager.create(Wallets, {
          userId: order.userId,
          walletBalance: 0,
          hasSetPin: false,
        }),
      );
    }

    const refundAmount = Math.max(0, Number(order.totalAmount) || 0);
    wallet.walletBalance = Number(wallet.walletBalance) + refundAmount;
    await manager.save(Wallets, wallet);
    await manager.save(
      Transactions,
      manager.create(Transactions, {
        userId: order.userId,
        walletId: wallet.id,
        receipientUserId: order.userId,
        receipientWalletId: wallet.id,
        amount: refundAmount,
        category: TransactionCategory.ORDER_REFUND,
        status: TransactionStatus.COMPLETED,
        description: `Refund for rejected order ${order.id}`,
        transactionReference: reference,
        orderId: order.id,
      }),
    );
  }
}

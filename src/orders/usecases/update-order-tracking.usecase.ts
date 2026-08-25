import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { StandardResponse } from '../../common/module/standard-response';
import { calculateRiderCommission } from '../../riders/rider-commission';
import { Rider } from '../../riders/model/rider.entity';
import { MailSenderService } from '../../user-otp/mail-sender.service';
import { OrderUpdateEvent } from '../../user-otp/events/order-update.event';
import { NotificationCategory } from '../../users/model/notification-category';
import { PushNotificationEvent } from '../../users/events/push-notification.event';
import { formatDeliveryDate } from '../../utility/function';
import { TransactionCategory } from '../../wallet/model/transaction-category.enum';
import { Transactions } from '../../wallet/model/transaction.entity';
import { TransactionStatus } from '../../wallet/model/transaction-status.enum';
import { Wallets } from '../../wallet/model/wallet.entity';
import { OrderStatus } from '../model/enum/order-status.enum';
import { OrderTypes } from '../model/enum/order-types.enum';
import { UpdateOrderTrackingDto } from '../model/dto/update-order.dto';
import { Orders } from '../model/order.entity';
import { OrderTracking } from '../model/order-tracking.entity';
import { OrderStatusChangedEvent } from '../../events';
import { getMerchantNetSettlement } from '../merchant-settlement';

type RiderCredit = {
  riderUserId: string;
  netRiderPayout: number;
};

type TrackingMutationResult = {
  applied: boolean;
  riderCredit: RiderCredit | null;
  merchantNetSettlement: number | null;
};

type CancellationConstraints = {
  ownerUserId?: string;
  allowedStatuses?: OrderStatus[];
};

@Injectable()
export class UpdateOrderTrackingUseCase {
  private readonly logger = new Logger(UpdateOrderTrackingUseCase.name);

  constructor(
    @InjectRepository(OrderTracking)
    private readonly orderTrackingRepository: Repository<OrderTracking>,
    @InjectRepository(Orders)
    private readonly ordersRepository: Repository<Orders>,
    private readonly mailSenderService: MailSenderService,
    private readonly eventBus: EventBus,
    private readonly dataSource: DataSource,
  ) {}

  async handle(orderId: string, updateOrderDto: UpdateOrderTrackingDto) {
    if (!orderId) {
      throw new BadRequestException(
        new StandardResponse(true, 'ORDER_ID_IS_REQUIRED'),
      );
    }

    const { status, cancellationReason } = updateOrderDto;
    if (status === OrderStatus.cancelled && !cancellationReason?.trim()) {
      throw new BadRequestException(
        new StandardResponse(true, 'CANCELLATION_REASON_IS_REQUIRED'),
      );
    }

    const order = await this.loadOrder(orderId);
    const previousStatus = order.status;
    if (
      order.status === status &&
      (status === OrderStatus.delivered || status === OrderStatus.cancelled)
    ) {
      const existingHistory = await this.orderTrackingRepository.find({
        where: { orderId },
        order: { createdAt: 'ASC' },
      });
      return new StandardResponse(
        false,
        'ORDER_TRACKING_STATUS_ALREADY_APPLIED',
        existingHistory,
      );
    }
    let mutation: TrackingMutationResult;

    if (status === OrderStatus.delivered) {
      mutation = await this.completeDelivery(orderId);
    } else if (status === OrderStatus.cancelled) {
      mutation = {
        applied: await this.cancelOrder(orderId, cancellationReason!.trim()),
        riderCredit: null,
        merchantNetSettlement: null,
      };
    } else {
      mutation = {
        applied: await this.recordStatus(orderId, status),
        riderCredit: null,
        merchantNetSettlement: null,
      };
    }

    const trackingHistory = await this.orderTrackingRepository.find({
      where: { orderId },
      order: { createdAt: 'ASC' },
    });

    // The row lock is the authority for idempotency. This covers two callers
    // that both passed the fast, pre-transaction status check concurrently.
    if (!mutation.applied) {
      return new StandardResponse(
        false,
        'ORDER_TRACKING_STATUS_ALREADY_APPLIED',
        trackingHistory,
      );
    }

    try {
      this.eventBus.publish(
        new OrderStatusChangedEvent(
          orderId,
          previousStatus,
          status,
          order.userId,
        ),
      );
      this.dispatchNotifications(
        status,
        order,
        mutation.riderCredit,
        mutation.merchantNetSettlement,
      );
      await this.dispatchEmailNotification(
        orderId,
        trackingHistory[trackingHistory.length - 1],
        cancellationReason,
        status,
      );
    } catch (error) {
      this.logger.error(
        `Order ${orderId} was committed as ${status}, but a post-commit notification failed.`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return new StandardResponse(
      false,
      'ORDER_TRACKING_STATUS_UPDATED_SUCCESSFULLY',
      trackingHistory,
    );
  }

  async cancelPendingOrderForCustomer(orderId: string, userId: string) {
    if (!orderId) {
      throw new BadRequestException(
        new StandardResponse(true, 'ORDER_ID_IS_REQUIRED'),
      );
    }

    const order = await this.loadOrder(orderId);
    const previousStatus = order.status;
    const applied = await this.cancelOrder(orderId, 'Cancelled by customer', {
      ownerUserId: userId,
      allowedStatuses: [OrderStatus.pending],
    });
    const trackingHistory = await this.orderTrackingRepository.find({
      where: { orderId },
      order: { createdAt: 'ASC' },
    });

    if (applied) {
      try {
        this.eventBus.publish(
          new OrderStatusChangedEvent(
            orderId,
            previousStatus,
            OrderStatus.cancelled,
            order.userId,
          ),
        );
        this.dispatchNotifications(OrderStatus.cancelled, order, null, null);
        await this.dispatchEmailNotification(
          orderId,
          trackingHistory[trackingHistory.length - 1],
          'Cancelled by customer',
          OrderStatus.cancelled,
        );
      } catch (error) {
        this.logger.error(
          `Order ${orderId} was cancelled, but a post-commit notification failed.`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return new StandardResponse(
      false,
      applied
        ? 'ORDER_CANCELLED_SUCCESSFULLY'
        : 'ORDER_TRACKING_STATUS_ALREADY_APPLIED',
      trackingHistory,
    );
  }

  private loadOrder(orderId: string) {
    return this.ordersRepository
      .findOne({
        where: { id: orderId },
        relations: [
          'store',
          'rider',
          'orderCharges',
          'orderCharges.chargeNodes',
        ],
      })
      .then((order) => {
        if (!order) {
          throw new NotFoundException(
            new StandardResponse(true, 'ORDER_NOT_FOUND'),
          );
        }
        return order;
      });
  }

  private async completeDelivery(
    orderId: string,
  ): Promise<TrackingMutationResult> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.loadLockedOrder(manager, orderId);
      const latest = await this.getLatestTracking(manager, orderId);
      if (
        order.status === OrderStatus.delivered ||
        latest?.orderStatus === OrderStatus.delivered
      ) {
        return {
          applied: false,
          riderCredit: null,
          merchantNetSettlement: null,
        };
      }
      this.assertCanFinalize(order.status, latest?.orderStatus);

      const awaitingTransaction = await manager.findOne(Transactions, {
        where: {
          orderId,
          status: TransactionStatus.AWAITING_DELIVERY,
        },
        lock: { mode: 'pessimistic_write' },
      });
      let merchantNetSettlement: number | null = null;
      if (awaitingTransaction) {
        awaitingTransaction.status = TransactionStatus.COMPLETED;
        await manager.save(Transactions, awaitingTransaction);

        if (order.store?.userId) {
          const merchantWallet = await this.getOrCreateLockedWallet(
            manager,
            order.store.userId,
          );
          const merchantNet = getMerchantNetSettlement(
            Number(awaitingTransaction.amount),
          );
          merchantWallet.walletBalance =
            Number(merchantWallet.walletBalance) + merchantNet;
          await manager.save(Wallets, merchantWallet);
          merchantNetSettlement = merchantNet;
        }
      } else {
        this.logger.warn(
          `Awaiting merchant transaction for order ${order.id} was not found.`,
        );
      }

      const riderCredit = await this.creditRider(manager, order);
      order.status = OrderStatus.delivered;
      order.deliveredAt = new Date();
      await manager.save(Orders, order);
      await this.saveTracking(manager, order, OrderStatus.delivered);
      return { applied: true, riderCredit, merchantNetSettlement };
    });
  }

  private async creditRider(
    manager: EntityManager,
    order: Orders,
  ): Promise<RiderCredit | null> {
    if (!order.riderId) return null;

    const reference = `rider_earning_${order.id}`;
    const existing = await manager.findOne(Transactions, {
      where: {
        transactionReference: In([reference, `rider_payout_${order.id}`]),
      },
    });
    if (existing) return null;

    const deliveryFee = Number(
      order.orderCharges?.chargeNodes?.find(
        (node) => node.name === 'deliveryFee',
      )?.amount || 0,
    );
    const commission = calculateRiderCommission(deliveryFee);
    if (commission.grossDeliveryFee <= 0) {
      this.logger.warn(
        `Order ${order.id} has no delivery-fee charge; rider was not credited.`,
      );
      return null;
    }

    const rider = await manager.findOne(Rider, {
      where: { id: order.riderId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!rider) throw new NotFoundException('RIDER_NOT_FOUND');

    const wallet = await this.getOrCreateLockedWallet(manager, rider.userId);
    wallet.walletBalance =
      Number(wallet.walletBalance) + commission.netRiderPayout;
    await manager.save(Wallets, wallet);

    const earning = manager.create(Transactions, {
      amount: commission.netRiderPayout,
      category: TransactionCategory.CREDIT,
      status: TransactionStatus.COMPLETED,
      walletId: wallet.id,
      userId: rider.userId,
      orderId: order.id,
      transactionReference: reference,
      receipientUserId: rider.userId,
      receipientWalletId: wallet.id,
      description: `Delivery earnings for order #${order.id}: gross NGN ${commission.grossDeliveryFee.toFixed(2)}, 20% commission NGN ${commission.platformCommission.toFixed(2)}, net NGN ${commission.netRiderPayout.toFixed(2)}`,
      metaData: {
        grossDeliveryFee: commission.grossDeliveryFee,
        platformCommissionRate: commission.platformCommissionRate,
        platformCommission: commission.platformCommission,
        netRiderPayout: commission.netRiderPayout,
        orderType: order.type,
      } as never,
    });
    await manager.save(Transactions, earning);

    rider.totalDeliveries = Number(rider.totalDeliveries || 0) + 1;
    rider.totalEarnings =
      Number(rider.totalEarnings || 0) + commission.netRiderPayout;
    await manager.save(Rider, rider);

    return {
      riderUserId: rider.userId,
      netRiderPayout: commission.netRiderPayout,
    };
  }

  private async cancelOrder(
    orderId: string,
    reason: string,
    constraints: CancellationConstraints = {},
  ) {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.loadLockedOrder(manager, orderId);
      const latest = await this.getLatestTracking(manager, orderId);
      if (constraints.ownerUserId && order.userId !== constraints.ownerUserId) {
        throw new ForbiddenException(
          new StandardResponse(
            true,
            'YOU_ARE_NOT_AUTHORIZED_TO_CANCEL_THIS_ORDER',
          ),
        );
      }
      if (
        order.status === OrderStatus.cancelled ||
        latest?.orderStatus === OrderStatus.cancelled
      ) {
        return false;
      }
      if (
        constraints.allowedStatuses &&
        (!constraints.allowedStatuses.includes(order.status) ||
          (latest != null &&
            !constraints.allowedStatuses.includes(latest.orderStatus)))
      ) {
        throw new BadRequestException(
          new StandardResponse(true, 'ORDER_CANNOT_BE_CANCELLED'),
        );
      }
      this.assertCanFinalize(order.status, latest?.orderStatus);

      if (order.userId) {
        const reference = `order_refund_${order.id}`;
        const existingRefund = await manager.findOne(Transactions, {
          where: { transactionReference: reference },
        });
        if (!existingRefund) {
          const wallet = await this.getOrCreateLockedWallet(
            manager,
            order.userId,
          );
          const refundAmount = Number(order.totalAmount || 0);
          wallet.walletBalance = Number(wallet.walletBalance) + refundAmount;
          await manager.save(Wallets, wallet);
          await manager.save(
            Transactions,
            manager.create(Transactions, {
              amount: refundAmount,
              category: TransactionCategory.ORDER_REFUND,
              status: TransactionStatus.COMPLETED,
              walletId: wallet.id,
              userId: order.userId,
              orderId: order.id,
              transactionReference: reference,
              receipientUserId: order.userId,
              receipientWalletId: wallet.id,
              description: `Refund for cancelled order #${order.id}`,
            }),
          );
        }
      }

      order.status = OrderStatus.cancelled;
      order.cancelledAt = new Date();
      await manager.save(Orders, order);
      await this.saveTracking(manager, order, OrderStatus.cancelled, reason);
      return true;
    });
  }

  private async recordStatus(orderId: string, status: OrderStatus) {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.loadLockedOrder(manager, orderId);
      const latest = await this.getLatestTracking(manager, orderId);
      if (order.status === status || latest?.orderStatus === status) {
        return false;
      }
      if (
        latest?.orderStatus === OrderStatus.delivered ||
        latest?.orderStatus === OrderStatus.cancelled
      ) {
        throw new BadRequestException(
          new StandardResponse(true, 'ORDER_ALREADY_FINALIZED'),
        );
      }

      order.status = status;
      if (status === OrderStatus.picked_up) order.pickedUpAt = new Date();
      if (status === OrderStatus.rejected) order.rejectedAt = new Date();
      await manager.save(Orders, order);
      await this.saveTracking(manager, order, status);
      return true;
    });
  }

  private async loadLockedOrder(manager: EntityManager, orderId: string) {
    const lockedOrder = await manager.findOne(Orders, {
      where: { id: orderId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!lockedOrder) throw new NotFoundException('ORDER_NOT_FOUND');

    // Lock only the order row: PostgreSQL rejects FOR UPDATE on nullable
    // relations produced by LEFT JOIN. Hydrate settlement data afterwards,
    // while the row lock remains held by this transaction.
    const hydratedOrder = await manager.findOne(Orders, {
      where: { id: orderId },
      relations: ['store', 'rider', 'orderCharges', 'orderCharges.chargeNodes'],
    });
    return hydratedOrder || lockedOrder;
  }

  private getLatestTracking(manager: EntityManager, orderId: string) {
    return manager.findOne(OrderTracking, {
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
  }

  private assertCanFinalize(
    orderStatus: OrderStatus,
    latestTrackingStatus?: OrderStatus,
  ) {
    if (
      orderStatus === OrderStatus.delivered ||
      latestTrackingStatus === OrderStatus.delivered
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'ORDER_HAS_BEEN_DELIVERED'),
      );
    }
    if (
      orderStatus === OrderStatus.cancelled ||
      orderStatus === OrderStatus.rejected ||
      latestTrackingStatus === OrderStatus.cancelled ||
      latestTrackingStatus === OrderStatus.rejected
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'ORDER_ALREADY_CANCELLED_OR_REFUNDED'),
      );
    }
  }

  private async getOrCreateLockedWallet(
    manager: EntityManager,
    userId: string,
  ) {
    let wallet = await manager.findOne(Wallets, {
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!wallet) {
      wallet = manager.create(Wallets, {
        userId,
        walletBalance: 0,
        hasSetPin: false,
      });
      wallet = await manager.save(Wallets, wallet);
    }
    return wallet;
  }

  private saveTracking(
    manager: EntityManager,
    order: Orders,
    status: OrderStatus,
    description?: string,
  ) {
    return manager.save(
      OrderTracking,
      manager.create(OrderTracking, {
        order,
        orderId: order.id,
        orderStatus: status,
        description: description || null,
      }),
    );
  }

  private dispatchNotifications(
    status: OrderStatus,
    order: Orders,
    riderCredit: RiderCredit | null,
    merchantNetSettlement: number | null,
  ) {
    if (status === OrderStatus.delivered) {
      const events = [
        new PushNotificationEvent(
          order.userId,
          NotificationCategory.ORDER_DELIVERED,
        ),
      ];
      if (order.store?.userId && merchantNetSettlement !== null) {
        events.push(
          new PushNotificationEvent(
            order.store.userId,
            NotificationCategory.VENDOR_ORDER_REWARD,
            `N${merchantNetSettlement.toFixed(2)}`,
          ),
        );
      }
      if (riderCredit) {
        events.push(
          new PushNotificationEvent(
            riderCredit.riderUserId,
            NotificationCategory.ORDER_DELIVERED,
            `You earned NGN ${riderCredit.netRiderPayout.toFixed(2)} for delivery #${order.id}.`,
          ),
        );
      }
      this.eventBus.publishAll(events);
    } else if (status === OrderStatus.cancelled) {
      const events = [
        new PushNotificationEvent(
          order.userId,
          NotificationCategory.ORDER_CANCELLED,
        ),
        new PushNotificationEvent(
          order.userId,
          NotificationCategory.ORDER_REFUND,
          `N${order.totalAmount}`,
        ),
      ];
      if (order.store?.userId) {
        events.push(
          new PushNotificationEvent(
            order.store.userId,
            NotificationCategory.USER_CANCELLED_ORDER,
          ),
        );
      }
      this.eventBus.publishAll(events);
    } else if (status === OrderStatus.picked_up) {
      this.eventBus.publish(
        new PushNotificationEvent(
          order.userId,
          NotificationCategory.ORDER_PICKED_UP,
        ),
      );
    } else if (status === OrderStatus.rejected) {
      this.eventBus.publish(
        new PushNotificationEvent(
          order.userId,
          NotificationCategory.ORDER_CANCELLED,
        ),
      );
    }
  }

  private async dispatchEmailNotification(
    orderId: string,
    latestTracking: OrderTracking | undefined,
    cancellationReason: string | undefined,
    status: OrderStatus,
  ) {
    if (!latestTracking) return;
    const fullOrder = await this.ordersRepository.findOne({
      where: { id: orderId },
      relations: ['user', 'store', 'orderItems', 'recipientInfo'],
    });
    if (!fullOrder) return;

    if (fullOrder.type === OrderTypes.logistics) {
      this.eventBus.publish(
        new OrderUpdateEvent(
          fullOrder.recipientInfo?.emailAddress,
          `CAD-${fullOrder.id}`,
          latestTracking.orderStatus,
          formatDeliveryDate(fullOrder.createdAt),
          fullOrder.recipientInfo?.deliveryAddress,
          (fullOrder.orderItems || []).map((item) => item.name).join(', '),
        ),
      );
      return;
    }

    if (!fullOrder.user?.email || !fullOrder.store) return;
    await this.mailSenderService.sendMail({
      recipient: fullOrder.user.email,
      subject:
        status === OrderStatus.cancelled
          ? 'Your Order Has Been Cancelled'
          : `Update on Your Order Status: ${status}`,
      template:
        status === OrderStatus.cancelled ? 'order-cancelled' : 'order-status',
      content: {
        customerName: `${fullOrder.user.lastName} ${fullOrder.user.firstName}`,
        orderDate: new Date(fullOrder.createdAt).toLocaleDateString(),
        storeName: fullOrder.store.name,
        storeAddress: fullOrder.store.address,
        deliveryFee: fullOrder.Charges,
        totalAmount: fullOrder.totalAmount,
        cancellationReason: cancellationReason || 'N/A',
        status,
        items: (fullOrder.orderItems || []).map((item) => ({
          name: item.name,
          quantity: item.quantity,
          price: item.price,
        })),
        currentYear: new Date().getFullYear(),
      },
    });
  }
}

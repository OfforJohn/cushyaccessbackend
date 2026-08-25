import { EventBus } from '@nestjs/cqrs';
import { DataSource, Repository } from 'typeorm';
import { MailSenderService } from '../../user-otp/mail-sender.service';
import { OrderStatus } from '../model/enum/order-status.enum';
import { OrderTypes } from '../model/enum/order-types.enum';
import { Orders } from '../model/order.entity';
import { OrderTracking } from '../model/order-tracking.entity';
import { Transactions } from '../../wallet/model/transaction.entity';
import { Wallets } from '../../wallet/model/wallet.entity';
import { Rider } from '../../riders/model/rider.entity';
import { UpdateOrderTrackingUseCase } from './update-order-tracking.usecase';
import { TransactionStatus } from '../../wallet/model/transaction-status.enum';
import { NotificationCategory } from '../../users/model/notification-category';

describe('UpdateOrderTrackingUseCase idempotency', () => {
  it('treats a concurrent delivery completion as a successful retry', async () => {
    const order = {
      id: 'ord_retry',
      status: OrderStatus.in_transit,
      orderCharges: { chargeNodes: [] },
    } as unknown as Orders;
    const deliveredTracking = {
      orderId: order.id,
      orderStatus: OrderStatus.delivered,
      createdAt: new Date(),
    } as OrderTracking;
    const orderTrackingRepository = {
      find: jest.fn().mockResolvedValue([deliveredTracking]),
    } as unknown as Repository<OrderTracking>;
    const ordersRepository = {
      findOne: jest.fn().mockResolvedValue(order),
    } as unknown as Repository<Orders>;
    const manager = {
      findOne: jest.fn(async (entity: unknown) =>
        entity === OrderTracking ? deliveredTracking : order,
      ),
      save: jest.fn(),
      create: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn((work) => work(manager)),
    } as unknown as DataSource;
    const eventBus = {
      publish: jest.fn(),
      publishAll: jest.fn(),
    } as unknown as EventBus;
    const mailSender = {
      sendMail: jest.fn(),
    } as unknown as MailSenderService;
    const useCase = new UpdateOrderTrackingUseCase(
      orderTrackingRepository,
      ordersRepository,
      mailSender,
      eventBus,
      dataSource,
    );

    const response = await useCase.handle(order.id, {
      status: OrderStatus.delivered,
    });

    expect((response as unknown as { message: string }).message).toBe(
      'ORDER_TRACKING_STATUS_ALREADY_APPLIED',
    );
    expect(manager.save).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
    expect(eventBus.publishAll).not.toHaveBeenCalled();
    expect(mailSender.sendMail).not.toHaveBeenCalled();
  });

  it('locks and refunds a customer cancellation exactly once across retries', async () => {
    const order = {
      id: 'ord_cancel_retry',
      userId: 'usr_customer',
      status: OrderStatus.pending,
      totalAmount: 1500,
      type: OrderTypes.logistics,
      createdAt: new Date(),
      orderCharges: { chargeNodes: [] },
      recipientInfo: { emailAddress: 'recipient@example.com' },
    } as unknown as Orders;
    let latest = {
      orderId: order.id,
      orderStatus: OrderStatus.pending,
      createdAt: new Date(),
    } as OrderTracking;
    const wallet = {
      id: 'wa_customer',
      userId: order.userId,
      walletBalance: 500,
    } as Wallets;
    const savedTransactions: Transactions[] = [];
    const manager = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === Orders) return order;
        if (entity === OrderTracking) return latest;
        if (entity === Transactions) return undefined;
        if (entity === Wallets) return wallet;
        return undefined;
      }),
      save: jest.fn(async (entity: unknown, value: any) => {
        if (entity === Transactions) savedTransactions.push(value);
        if (entity === OrderTracking) latest = value;
        return value;
      }),
      create: jest.fn((_entity, value) => value),
    };
    const repositories = {
      tracking: {
        find: jest.fn(async () => [latest]),
      } as unknown as Repository<OrderTracking>,
      orders: {
        findOne: jest.fn().mockResolvedValue(order),
      } as unknown as Repository<Orders>,
    };
    const eventBus = {
      publish: jest.fn(),
      publishAll: jest.fn(),
    } as unknown as EventBus;
    const useCase = new UpdateOrderTrackingUseCase(
      repositories.tracking,
      repositories.orders,
      { sendMail: jest.fn() } as unknown as MailSenderService,
      eventBus,
      {
        transaction: jest.fn((work) => work(manager)),
      } as unknown as DataSource,
    );

    await useCase.cancelPendingOrderForCustomer(order.id, order.userId);
    await useCase.cancelPendingOrderForCustomer(order.id, order.userId);

    expect(wallet.walletBalance).toBe(2000);
    expect(savedTransactions).toHaveLength(1);
    expect(savedTransactions[0]).toMatchObject({
      transactionReference: `order_refund_${order.id}`,
      amount: 1500,
    });
    expect(order.status).toBe(OrderStatus.cancelled);
    expect(eventBus.publishAll).toHaveBeenCalledTimes(1);
    expect(manager.findOne).toHaveBeenCalledWith(
      Wallets,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });

  it('does not credit an order again when a legacy rider payout exists', async () => {
    const order = {
      id: 'ord_legacy_paid',
      userId: 'usr_customer',
      riderId: 'rider_1',
      status: OrderStatus.in_transit,
      type: OrderTypes.q_commerce,
      createdAt: new Date(),
      orderCharges: {
        chargeNodes: [{ name: 'deliveryFee', amount: 1000 }],
      },
    } as unknown as Orders;
    let latest = {
      orderId: order.id,
      orderStatus: OrderStatus.in_transit,
      createdAt: new Date(),
    } as OrderTracking;
    const legacyEarning = {
      transactionReference: `rider_payout_${order.id}`,
    } as Transactions;
    const manager = {
      findOne: jest.fn(async (entity: unknown, options?: any) => {
        if (entity === Orders) return order;
        if (entity === OrderTracking) return latest;
        if (entity === Transactions) {
          const reference = options?.where?.transactionReference;
          const references = Array.isArray(reference?._value)
            ? reference._value
            : [reference];
          return references.includes(legacyEarning.transactionReference)
            ? legacyEarning
            : undefined;
        }
        if (entity === Rider || entity === Wallets) {
          throw new Error('A paid delivery must not reach wallet crediting');
        }
        return undefined;
      }),
      save: jest.fn(async (entity: unknown, value: any) => {
        if (entity === OrderTracking) latest = value;
        return value;
      }),
      create: jest.fn((_entity, value) => value),
    };
    const trackingRepository = {
      find: jest.fn(async () => [latest]),
    } as unknown as Repository<OrderTracking>;
    const useCase = new UpdateOrderTrackingUseCase(
      trackingRepository,
      {
        findOne: jest.fn().mockResolvedValue(order),
      } as unknown as Repository<Orders>,
      { sendMail: jest.fn() } as unknown as MailSenderService,
      { publish: jest.fn(), publishAll: jest.fn() } as unknown as EventBus,
      {
        transaction: jest.fn((work) => work(manager)),
      } as unknown as DataSource,
    );

    await useCase.handle(order.id, { status: OrderStatus.delivered });

    expect(manager.save).not.toHaveBeenCalledWith(
      Transactions,
      expect.anything(),
    );
    expect(manager.findOne).not.toHaveBeenCalledWith(
      Wallets,
      expect.anything(),
    );
  });

  it('credits and reports the merchant net amount after the 5% fee', async () => {
    const order = {
      id: 'ord_merchant_credit',
      userId: 'usr_customer',
      status: OrderStatus.in_transit,
      type: OrderTypes.q_commerce,
      store: { userId: 'usr_vendor' },
      orderCharges: { chargeNodes: [] },
      createdAt: new Date(),
    } as unknown as Orders;
    let latest = {
      orderId: order.id,
      orderStatus: OrderStatus.in_transit,
      createdAt: new Date(),
    } as OrderTracking;
    const awaiting = {
      amount: 2700,
      status: TransactionStatus.AWAITING_DELIVERY,
    } as Transactions;
    const merchantWallet = {
      id: 'wa_vendor',
      userId: 'usr_vendor',
      walletBalance: 100,
    } as Wallets;
    const manager = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === Orders) return order;
        if (entity === OrderTracking) return latest;
        if (entity === Transactions) return awaiting;
        if (entity === Wallets) return merchantWallet;
        return undefined;
      }),
      save: jest.fn(async (entity: unknown, value: any) => {
        if (entity === OrderTracking) latest = value;
        return value;
      }),
      create: jest.fn((_entity, value) => value),
    };
    const eventBus = {
      publish: jest.fn(),
      publishAll: jest.fn(),
    } as unknown as EventBus;
    const useCase = new UpdateOrderTrackingUseCase(
      {
        find: jest.fn(async () => [latest]),
      } as unknown as Repository<OrderTracking>,
      {
        findOne: jest.fn().mockResolvedValue(order),
      } as unknown as Repository<Orders>,
      { sendMail: jest.fn() } as unknown as MailSenderService,
      eventBus,
      {
        transaction: jest.fn((work) => work(manager)),
      } as unknown as DataSource,
    );

    await useCase.handle(order.id, { status: OrderStatus.delivered });

    expect(merchantWallet.walletBalance).toBe(2665);
    expect(awaiting.status).toBe(TransactionStatus.COMPLETED);
    expect(eventBus.publishAll).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'usr_vendor',
          notificationCategory: NotificationCategory.VENDOR_ORDER_REWARD,
          additionalInfo: 'N2565.00',
        }),
      ]),
    );
  });
});

import { DataSource } from 'typeorm';
import { OrderStatus } from '../../orders/model/enum/order-status.enum';
import { OrderTypes } from '../../orders/model/enum/order-types.enum';
import { Orders } from '../../orders/model/order.entity';
import { Rider } from '../../riders/model/rider.entity';
import { Transactions } from '../model/transaction.entity';
import { Wallets } from '../model/wallet.entity';
import { RiderEarningsRecoveryService } from './rider-earnings-recovery.service';

describe('RiderEarningsRecoveryService', () => {
  it('credits a delivered order that is missing its rider earning exactly once', async () => {
    const rider = {
      id: 'rider_1',
      userId: 'user_rider_1',
      totalDeliveries: 3,
      totalEarnings: 50,
    } as Rider;
    const lockedOrder = {
      id: 'order_1',
      riderId: rider.id,
      status: OrderStatus.delivered,
    } as Orders;
    const hydratedOrder = {
      ...lockedOrder,
      type: OrderTypes.logistics,
      orderCharges: {
        chargeNodes: [{ name: 'deliveryFee', amount: 1000 }],
      },
    } as unknown as Orders;
    const wallet = {
      id: 'wallet_1',
      userId: rider.userId,
      walletBalance: 100,
    } as Wallets;
    const savedTransactions: Transactions[] = [];
    const queryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: lockedOrder.id }]),
    };
    const manager = {
      findOne: jest.fn(async (entity: unknown, options?: any) => {
        if (entity === Orders) {
          return options?.lock ? lockedOrder : hydratedOrder;
        }
        if (entity === Transactions) return savedTransactions[0];
        if (entity === Rider) return rider;
        if (entity === Wallets) return wallet;
        return null;
      }),
      create: jest.fn((_entity, value) => value),
      save: jest.fn(async (entity: unknown, value: any) => {
        if (entity === Transactions) savedTransactions.push(value);
        return value;
      }),
    };
    const riderRepository = {
      findOne: jest.fn().mockResolvedValue(rider),
    };
    const orderRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Rider) return riderRepository;
        if (entity === Orders) return orderRepository;
        return null;
      }),
      transaction: jest.fn((work) => work(manager)),
    } as unknown as DataSource;
    const service = new RiderEarningsRecoveryService(dataSource);

    const firstRecovery = await service.reconcileForUser(rider.userId);
    const retry = await service.reconcileForUser(rider.userId);

    expect(firstRecovery).toBe(800);
    expect(retry).toBe(0);
    expect(wallet.walletBalance).toBe(900);
    expect(rider.totalDeliveries).toBe(4);
    expect(rider.totalEarnings).toBe(850);
    expect(savedTransactions).toHaveLength(1);
    expect(savedTransactions[0]).toMatchObject({
      amount: 800,
      orderId: lockedOrder.id,
      transactionReference: `rider_earning_${lockedOrder.id}`,
      receipientUserId: rider.userId,
      metaData: expect.objectContaining({ recovered: true }),
    });
    expect(queryBuilder.innerJoin).toHaveBeenCalledTimes(4);
  });
});

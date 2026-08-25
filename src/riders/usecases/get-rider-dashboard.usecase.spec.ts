/// <reference types="jest" />

import { OrderStatus } from '../../orders/model/enum/order-status.enum';
import { TransactionStatus } from '../../wallet/model/transaction-status.enum';
import { GetRiderDashboardUseCase } from './get-rider-dashboard.usecase';

const chain = (terminal: Record<string, jest.Mock>) => {
  const builder: Record<string, jest.Mock> = {
    where: jest.fn(),
    andWhere: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    setParameters: jest.fn(),
    ...terminal,
  };
  for (const method of [
    'where',
    'andWhere',
    'select',
    'addSelect',
    'setParameters',
  ]) {
    builder[method].mockReturnValue(builder);
  }
  return builder;
};

describe('GetRiderDashboardUseCase', () => {
  it('uses wallet ownership and maps current earnings/order statistics', async () => {
    const transactionQuery = chain({
      getMany: jest
        .fn()
        .mockResolvedValue([{ amount: '1200.10' }, { amount: '500.04' }]),
    });
    const orderQuery = chain({
      getRawOne: jest.fn().mockResolvedValue({
        tripsDone: '2',
        completedOrders: '4',
        pendingOrders: '1',
        assignedOrders: '5',
      }),
    });
    const riderRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'rider-1',
        userId: 'user-1',
        isOnline: true,
        onlineHours: 3,
        rating: 4.5,
        activeCategories: ['food'],
      }),
    };
    const recovery = {
      reconcileForUser: jest.fn().mockResolvedValue(undefined),
    };
    const useCase = new GetRiderDashboardUseCase(
      riderRepository as never,
      { createQueryBuilder: jest.fn(() => orderQuery) } as never,
      { createQueryBuilder: jest.fn(() => transactionQuery) } as never,
      {
        getLoggedInUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
      } as never,
      recovery as never,
    );

    const response = await useCase.execute();

    expect(recovery.reconcileForUser).toHaveBeenCalledWith('user-1');
    expect(transactionQuery.where).toHaveBeenCalledWith(
      'walletTransaction.userId = :userId',
      { userId: 'user-1' },
    );
    expect(transactionQuery.andWhere).toHaveBeenCalledWith(
      'walletTransaction.status = :status',
      { status: TransactionStatus.COMPLETED },
    );
    expect(orderQuery.where).toHaveBeenCalledWith('order.riderId = :riderId', {
      riderId: 'rider-1',
    });
    expect(orderQuery.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveredStatus: OrderStatus.delivered,
        activeStatuses: expect.arrayContaining([
          OrderStatus.acknoledged,
          OrderStatus.picked_up,
          OrderStatus.in_transit,
        ]),
      }),
    );
    expect(response.toJSON()).toEqual(
      expect.objectContaining({
        error: false,
        message: 'DASHBOARD_DATA_FETCHED',
        data: expect.objectContaining({
          todayEarnings: 1700.14,
          tripsDone: 2,
          pendingOrders: 1,
          completionRate: 80,
          rating: 4.5,
        }),
      }),
    );
  });
});

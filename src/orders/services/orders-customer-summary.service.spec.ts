import { OrderStatus } from '../model/enum/order-status.enum';
import { OrderTypes } from '../model/enum/order-types.enum';
import { OrdersService } from './orders.service';

describe('OrdersService customer home and list metadata', () => {
  const ordersRepository = {
    exists: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const orderItemsRepository = {
    createQueryBuilder: jest.fn(),
  };
  const commonService = {
    getLoggedInUser: jest.fn().mockResolvedValue({ id: 'customer_1' }),
  };
  const service = Object.create(OrdersService.prototype) as any;
  service.ordersRepository = ordersRepository;
  service.orderItemsRepository = orderItemsRepository;
  service.commonService = commonService;

  beforeEach(() => {
    jest.clearAllMocks();
    commonService.getLoggedInUser.mockResolvedValue({ id: 'customer_1' });
  });

  it('returns a lightweight order-history summary for Just For Me', async () => {
    ordersRepository.exists.mockResolvedValue(true);

    const response = await service.getCustomerOrderSummary();

    expect(ordersRepository.exists).toHaveBeenCalledWith({
      where: {
        userId: 'customer_1',
        type: OrderTypes.q_commerce,
      },
    });
    expect(response.toJSON().data).toEqual({
      hasOrders: true,
    });
  });

  it('includes placed and latest status-change timestamps in order rows', async () => {
    const queryBuilder: any = {
      leftJoinAndSelect: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      skip: jest.fn(),
      take: jest.fn(),
      getRawAndEntities: jest.fn(),
      getCount: jest.fn(),
    };
    Object.values(queryBuilder).forEach((method: any) => {
      if (
        method?.mockReturnValue &&
        method !== queryBuilder.getRawAndEntities
      ) {
        method.mockReturnValue(queryBuilder);
      }
    });
    const createdAt = new Date('2026-07-30T01:45:00.000Z');
    const statusChangedAt = new Date('2026-07-30T02:10:00.000Z');
    queryBuilder.getRawAndEntities.mockResolvedValue({
      entities: [
        {
          id: 'order_1',
          totalItems: 2,
          type: OrderTypes.q_commerce,
          totalAmount: 4500,
          createdAt,
          updatedAt: statusChangedAt,
          riderId: null,
          dropOffLocation: { address: 'Wuse, Abuja' },
          store: { id: 'store_1', name: 'Cushy Kitchen' },
          orderTracking: [
            {
              orderStatus: OrderStatus.acknoledged,
              description: 'Accepted',
              createdAt: statusChangedAt,
            },
          ],
        },
      ],
    });
    queryBuilder.getCount.mockResolvedValue(1);
    ordersRepository.createQueryBuilder.mockReturnValue(queryBuilder);

    const result = await service.getOrdersByStatus(OrderStatus.acknoledged, {
      page: 1,
      size: 10,
    } as any);

    expect(result.orders[0]).toEqual(
      expect.objectContaining({
        dateCreated: createdAt,
        statusChangedAt,
      }),
    );
  });

  it('returns up to five distinct recent products with current images', async () => {
    const queryBuilder: any = {
      innerJoinAndSelect: jest.fn(),
      leftJoinAndSelect: jest.fn(),
      leftJoinAndMapOne: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      take: jest.fn(),
      getMany: jest.fn(),
    };
    Object.values(queryBuilder).forEach((method: any) => {
      if (method?.mockReturnValue && method !== queryBuilder.getMany) {
        method.mockReturnValue(queryBuilder);
      }
    });
    queryBuilder.getMany.mockResolvedValue([
      {
        orderId: 'order_2',
        menuItemId: 'meal_1',
        name: 'Grilled fish',
        quantity: 2,
        price: 4200,
        images: null,
        order: { store: { id: 'store_1', name: 'Cushy Kitchen' } },
        currentMenuItem: {
          id: 'meal_1',
          images: ['https://cdn.example/fish.jpg'],
          isAvailable: true,
        },
      },
      {
        orderId: 'order_1',
        menuItemId: 'meal_1',
        name: 'Grilled fish',
        quantity: 1,
        price: 4000,
        order: { store: { id: 'store_1', name: 'Cushy Kitchen' } },
        currentMenuItem: {
          id: 'meal_1',
          images: ['https://cdn.example/fish.jpg'],
          isAvailable: true,
        },
      },
      {
        orderId: 'order_legacy',
        menuItemId: 'meal_deleted',
        name: 'Legacy meal',
        quantity: 1,
        price: 2500,
        images: ['https://cdn.example/legacy.jpg'],
        order: { store: { id: 'store_1', name: 'Cushy Kitchen' } },
      },
    ]);
    orderItemsRepository.createQueryBuilder.mockReturnValue(queryBuilder);

    const response = await service.getRecentOrderItems();

    expect(queryBuilder.take).toHaveBeenCalledWith(25);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'latestTracking.orderStatus = :status',
      { status: OrderStatus.delivered },
    );
    expect(response.toJSON().data).toEqual([
      expect.objectContaining({
        menuItemId: 'meal_1',
        name: 'Grilled fish',
        quantity: 2,
        image: 'https://cdn.example/fish.jpg',
      }),
      expect.objectContaining({
        menuItemId: 'meal_deleted',
        name: 'Legacy meal',
        image: 'https://cdn.example/legacy.jpg',
        isAvailable: false,
      }),
    ]);
  });
});

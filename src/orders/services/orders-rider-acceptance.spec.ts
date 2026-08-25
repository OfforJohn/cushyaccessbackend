import { BadRequestException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { DataSource, Repository } from 'typeorm';
import { Rider, RiderStatus } from '../../riders/model/rider.entity';
import { RiderService } from '../../riders/services/riders.service';
import { OrderStatus } from '../model/enum/order-status.enum';
import { Orders } from '../model/order.entity';
import { OrderTracking } from '../model/order-tracking.entity';
import { OrdersService } from './orders.service';
import { UserLocations } from '../../users/model/user-locations.entity';

const makeService = (
  activeOrderExists: boolean,
  orderStatus = OrderStatus.pending,
  latestTrackingStatus = OrderStatus.acknoledged,
) => {
  const rider = {
    id: 'rider_1',
    userId: 'usr_rider',
    user: { firstName: 'Ada' },
    status: RiderStatus.ACTIVE,
    isOnline: true,
    trainingCompleted: true,
    backgroundCheckStatus: 'approved',
    currentLatitude: 9.0153312,
    currentLongitude: 7.568101,
    lastLocationUpdate: new Date(),
  } as unknown as Rider;
  const pendingOrder = {
    id: 'ord_1',
    status: orderStatus,
    riderId: null,
    pickUpLocationId: 'pickup_1',
  } as Orders;
  const acceptedOrder = {
    ...pendingOrder,
    status: OrderStatus.acknoledged,
    riderId: rider.id,
    rider,
    orderItems: [],
    orderCharges: {
      chargeNodes: [{ name: 'deliveryFee', amount: 1000 }],
    },
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
  } as unknown as Orders;
  const manager = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === Rider) return rider;
      if (entity === Orders) return pendingOrder;
      if (entity === OrderTracking) {
        return { orderId: 'ord_1', orderStatus: latestTrackingStatus };
      }
      if (entity === UserLocations) {
        return { id: 'pickup_1', latitude: '9.02', longitude: '7.57' };
      }
      return null;
    }),
    exists: jest.fn().mockResolvedValue(activeOrderExists),
    save: jest.fn(async (_entity, value) => value),
    create: jest.fn((_entity, value) => value),
  };
  const ordersRepository = {
    findOne: jest.fn().mockResolvedValue(acceptedOrder),
  } as unknown as Repository<Orders>;
  const riderService = {
    findByUserId: jest.fn().mockResolvedValue(rider),
  } as unknown as RiderService;
  const eventBus = { publish: jest.fn() } as unknown as EventBus;
  const service = Object.create(OrdersService.prototype) as OrdersService;
  Object.assign(service, {
    riderService,
    dataSource: {
      transaction: (work: (entityManager: typeof manager) => unknown) =>
        work(manager),
    } as unknown as DataSource,
    ordersRepository,
    eventBus,
  });
  return {
    service,
    manager,
    ordersRepository,
    eventBus,
    acceptedOrder,
  };
};

describe('OrdersService rider acceptance', () => {
  it('prevents a rider from accepting a second active delivery', async () => {
    const { service, manager } = makeService(true);

    await expect(
      service.acceptOrder('ord_1', 'usr_rider'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('hydrates delivery charges in the accepted-order response', async () => {
    const { service, manager, ordersRepository } = makeService(false);

    const response = await service.acceptOrder('ord_1', 'usr_rider');

    expect(response).toMatchObject({
      deliveryFee: 1000,
      riderCommission: 200,
      riderPayout: 800,
    });
    expect(manager.save).toHaveBeenCalledWith(
      OrderTracking,
      expect.objectContaining({ orderStatus: OrderStatus.acknoledged }),
    );
    expect(ordersRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        relations: expect.arrayContaining(['orderCharges.chargeNodes']),
      }),
    );
  });

  it('accepts an unassigned order whose row is already acknowledged', async () => {
    const { service, manager } = makeService(false, OrderStatus.acknoledged);

    await expect(
      service.acceptOrder('ord_1', 'usr_rider'),
    ).resolves.toMatchObject({ id: 'ord_1', status: OrderStatus.acknoledged });
    expect(manager.save).toHaveBeenCalledWith(
      Orders,
      expect.objectContaining({
        riderId: 'rider_1',
        status: OrderStatus.acknoledged,
      }),
    );
  });

  it('accepts a rider note without requiring any SMS dependency', async () => {
    const { service, acceptedOrder } = makeService(false);
    acceptedOrder.noteForRider = 'Call the customer at the gate.';
    acceptedOrder.rider.user.mobile = '08030000000';

    await expect(
      service.acceptOrder('ord_1', 'usr_rider'),
    ).resolves.toMatchObject({ id: 'ord_1' });
  });

  it('rejects a direct claim before the merchant acknowledges the order', async () => {
    const { service, manager } = makeService(
      false,
      OrderStatus.pending,
      OrderStatus.pending,
    );

    await expect(service.acceptOrder('ord_1', 'usr_rider')).rejects.toThrow(
      'Order is not yet acknowledged by the merchant',
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects accepting an order whose pickup is outside the rider area', async () => {
    const { service, manager } = makeService(false);
    manager.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Rider) {
        return {
          id: 'rider_1',
          userId: 'usr_rider',
          user: { firstName: 'Ada' },
          status: RiderStatus.ACTIVE,
          isOnline: true,
          trainingCompleted: true,
          backgroundCheckStatus: 'approved',
          currentLatitude: 9.0153312,
          currentLongitude: 7.568101,
          lastLocationUpdate: new Date(),
        } as unknown as Rider;
      }
      if (entity === Orders) {
        return {
          id: 'ord_1',
          status: OrderStatus.pending,
          riderId: null,
          pickUpLocationId: 'pickup_1',
        } as Orders;
      }
      if (entity === OrderTracking) {
        return {
          orderId: 'ord_1',
          orderStatus: OrderStatus.acknoledged,
        };
      }
      if (entity === UserLocations) {
        return {
          id: 'pickup_1',
          latitude: '9.6139',
          longitude: '6.5569',
        } as UserLocations;
      }
      return null;
    });

    await expect(
      service.acceptOrder('ord_1', 'usr_rider'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });
});

describe('OrdersService cancellation status events', () => {
  it('publishes the actual previous status after cancellation', async () => {
    const order = {
      id: 'ord_cancel',
      userId: 'customer_1',
      riderId: null,
      status: OrderStatus.acknoledged,
    } as Orders;
    const ordersRepository = {
      findOne: jest.fn().mockResolvedValue(order),
      save: jest.fn(async (value) => value),
    };
    const eventBus = { publish: jest.fn() };
    const service = Object.create(OrdersService.prototype) as OrdersService;
    Object.assign(service, {
      ordersRepository,
      usersService: { isAdmin: jest.fn().mockResolvedValue(false) },
      eventBus,
    });
    jest
      .spyOn(service as any, 'mapToOrderResponse')
      .mockImplementation((value) => value);

    await service.cancelOrder('ord_cancel', 'customer_1', 'Changed plans');

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ord_cancel',
        oldStatus: OrderStatus.acknoledged,
        newStatus: OrderStatus.cancelled,
      }),
    );
  });
});

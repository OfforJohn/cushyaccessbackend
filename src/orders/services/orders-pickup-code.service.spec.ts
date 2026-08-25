import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderStatus } from '../model/enum/order-status.enum';
import { OrderTracking } from '../model/order-tracking.entity';
import { Orders } from '../model/order.entity';
import { OrdersService } from './orders.service';

describe('OrdersService pickup-code validation', () => {
  const createService = (
    pickupCode = '482913',
    status: OrderStatus = OrderStatus.acknoledged,
  ) => {
    const order = {
      id: 'order-1',
      userId: 'user-1',
      riderId: 'rider-1',
      pickupCode,
      status,
      store: { userId: 'vendor-1' },
    } as unknown as Orders;
    let latestTracking = {
      orderId: order.id,
      orderStatus: status,
      createdAt: new Date(),
    } as OrderTracking;
    const manager = {
      findOne: jest.fn(async (entity: unknown) =>
        entity === Orders ? order : latestTracking,
      ),
      save: jest.fn(async (entity: unknown, value: any) => {
        if (entity === OrderTracking) latestTracking = value;
        return value;
      }),
      create: jest.fn((_entity, value) => value),
    };
    const eventBus = { publish: jest.fn() };
    const service = Object.create(OrdersService.prototype) as OrdersService;
    Object.assign(service, {
      dataSource: {
        transaction: jest.fn((work) => work(manager)),
      } as unknown as DataSource,
      eventBus,
      logger: { error: jest.fn() },
    });

    return { service, order, manager, eventBus };
  };

  it('rejects an invalid code without changing the order', async () => {
    const { service, manager } = createService();

    await expect(
      service.validatePickupCode('order-1', '000000', 'vendor-1'),
    ).rejects.toThrow('INVALID_PICKUP_CODE');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('reports an incorrect code before a mutable assignment-state error', async () => {
    const { service, order, manager } = createService();
    order.riderId = null;

    await expect(
      service.validatePickupCode('order-1', '000000', 'vendor-1'),
    ).rejects.toThrow('INVALID_PICKUP_CODE');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('reports a missing rider separately when the code is correct', async () => {
    const { service, order, manager } = createService();
    order.riderId = null;

    await expect(
      service.validatePickupCode('order-1', '482913', 'vendor-1'),
    ).rejects.toThrow('RIDER_NOT_ASSIGNED_TO_ORDER');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('locks and atomically advances a valid pickup', async () => {
    const { service, order, manager, eventBus } = createService();

    const response = await service.validatePickupCode(
      'order-1',
      '482913',
      'vendor-1',
    );

    expect(response.toJSON()).toMatchObject({
      error: false,
      message: 'PICKUP_CODE_VALIDATED_SUCCESSFULLY',
      data: {
        orderId: 'order-1',
        status: OrderStatus.picked_up,
        previousStatus: OrderStatus.acknoledged,
      },
    });
    expect(order.status).toBe(OrderStatus.picked_up);
    expect(manager.findOne.mock.calls[0]).toEqual([
      Orders,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    ]);
    expect(manager.save).toHaveBeenCalledWith(
      OrderTracking,
      expect.objectContaining({ orderStatus: OrderStatus.picked_up }),
    );
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('treats a response-lost retry as successful without duplicate work', async () => {
    const { service, manager, eventBus } = createService(
      '482913',
      OrderStatus.picked_up,
    );

    const response = await service.validatePickupCode(
      'order-1',
      '482913',
      'vendor-1',
    );

    expect(response.toJSON()).toMatchObject({
      error: false,
      message: 'PICKUP_CODE_ALREADY_VALIDATED',
    });
    expect(manager.save).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('prevents one vendor from validating another vendor order', async () => {
    const { service, manager } = createService();

    await expect(
      service.validatePickupCode('order-1', '482913', 'vendor-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.save).not.toHaveBeenCalled();
  });
});

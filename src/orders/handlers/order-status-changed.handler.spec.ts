import { OrderStatusChangedEvent } from '../../events';
import { RiderGateway } from '../../riders/gateways/rider.gateway';
import { OrderStatus } from '../model/enum/order-status.enum';
import { OrderStatusChangedHandler } from './order-status-changed.handler';

describe('OrderStatusChangedHandler rider assignment events', () => {
  it('excludes the winning rider from the shared unavailable event', async () => {
    const rider = { id: 'rider_1', userId: 'user_1' };
    const ordersRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'order_1',
        riderId: rider.id,
        rider,
      }),
    };
    const riderRepository = { findOne: jest.fn() };
    const riderGateway = {
      notifyOrderUnavailable: jest.fn(),
      notifyOrderStatusUpdate: jest.fn(),
    };
    const handler = new OrderStatusChangedHandler(
      ordersRepository as never,
      riderRepository as never,
      riderGateway as never,
    );

    await handler.handle(
      new OrderStatusChangedEvent(
        'order_1',
        OrderStatus.pending,
        OrderStatus.acknoledged,
        rider.userId,
      ),
    );

    expect(riderGateway.notifyOrderUnavailable).toHaveBeenCalledWith(
      'order_1',
      OrderStatus.acknoledged,
      true,
      rider.userId,
    );
    expect(riderGateway.notifyOrderStatusUpdate).toHaveBeenCalledWith(
      rider.userId,
      'order_1',
      OrderStatus.acknoledged,
    );
  });

  it('does not exclude the assigned rider from a cancellation event', async () => {
    const rider = { id: 'rider_1', userId: 'user_1' };
    const riderGateway = {
      notifyOrderUnavailable: jest.fn(),
      notifyOrderStatusUpdate: jest.fn(),
    };
    const handler = new OrderStatusChangedHandler(
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'order_1',
          riderId: rider.id,
          rider,
        }),
      } as never,
      { findOne: jest.fn() } as never,
      riderGateway as never,
    );

    await handler.handle(
      new OrderStatusChangedEvent(
        'order_1',
        OrderStatus.acknoledged,
        OrderStatus.cancelled,
        'customer_1',
      ),
    );

    expect(riderGateway.notifyOrderUnavailable).toHaveBeenCalledWith(
      'order_1',
      OrderStatus.cancelled,
      true,
      undefined,
    );
  });
});

describe('RiderGateway unavailable event targeting', () => {
  it('broadcasts an accepted offer to everyone except the winning user room', () => {
    const gateway = new RiderGateway({} as never);
    const restrictedEmitter = { emit: jest.fn() };
    const server = {
      emit: jest.fn(),
      except: jest.fn().mockReturnValue(restrictedEmitter),
    };
    gateway.server = server as never;

    gateway.notifyOrderUnavailable(
      'order_1',
      OrderStatus.acknoledged,
      true,
      'user_1',
    );

    expect(server.except).toHaveBeenCalledWith('authenticated-user:user_1');
    expect(restrictedEmitter.emit).toHaveBeenCalledWith('order:unavailable', {
      orderId: 'order_1',
      status: OrderStatus.acknoledged,
      assigned: true,
    });
    expect(server.emit).not.toHaveBeenCalled();
  });
});

import { Repository } from 'typeorm';
import { CommonService } from '../../common/common.service';
import { Rider } from '../../riders/model/rider.entity';
import { OrderStatus } from '../model/enum/order-status.enum';
import { Orders } from '../model/order.entity';
import { OrdersService } from '../services/orders.service';
import { GetActiveDeliveryUseCase } from './get-active-delivery.usecase';

describe('GetActiveDeliveryUseCase', () => {
  const rider = { id: 'rider_1', userId: 'user_rider_1' } as Rider;
  const commonService = {
    getLoggedInUser: jest.fn().mockResolvedValue({ id: rider.userId }),
  } as unknown as CommonService;
  const riderRepository = {
    findOne: jest.fn().mockResolvedValue(rider),
  } as unknown as Repository<Rider>;

  it('rejects a stale acknowledged row when its latest tracking is cancelled', async () => {
    const ordersRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'ord_cancelled',
        status: OrderStatus.acknoledged,
        orderTracking: [
          {
            orderStatus: OrderStatus.acknoledged,
            createdAt: new Date('2026-08-07T09:00:00Z'),
          },
          {
            orderStatus: OrderStatus.cancelled,
            createdAt: new Date('2026-08-07T10:00:00Z'),
          },
        ],
      }),
    } as unknown as Repository<Orders>;
    const ordersService = {
      findById: jest.fn(),
    } as unknown as OrdersService;
    const useCase = new GetActiveDeliveryUseCase(
      ordersRepository,
      riderRepository,
      commonService,
      ordersService,
    );

    const result = await useCase.execute();

    expect((result as unknown as { data: unknown }).data).toBeNull();
    expect(ordersService.findById).not.toHaveBeenCalled();
  });

  it('returns an order whose latest tracking status is still active', async () => {
    const order = {
      id: 'ord_active',
      status: OrderStatus.in_transit,
      orderTracking: [
        {
          orderStatus: OrderStatus.in_transit,
          createdAt: new Date('2026-08-07T10:00:00Z'),
        },
      ],
    } as Orders;
    const ordersRepository = {
      findOne: jest.fn().mockResolvedValue(order),
    } as unknown as Repository<Orders>;
    const ordersService = {
      findById: jest.fn().mockResolvedValue({ data: order }),
    } as unknown as OrdersService;
    const useCase = new GetActiveDeliveryUseCase(
      ordersRepository,
      riderRepository,
      commonService,
      ordersService,
    );

    await useCase.execute();

    expect(ordersService.findById).toHaveBeenCalledWith(order.id);
    const query = (ordersRepository.findOne as jest.Mock).mock.calls[0][0];
    expect(query.where).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          riderId: rider.id,
          cancelledAt: expect.anything(),
          deliveredAt: expect.anything(),
          rejectedAt: expect.anything(),
        }),
      ]),
    );
  });
});

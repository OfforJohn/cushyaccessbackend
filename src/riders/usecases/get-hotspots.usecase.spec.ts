import { Orders } from '../../orders/model/order.entity';
import { Rider } from '../model/rider.entity';
import { GetHotspotsUseCase } from './get-hotspots.usecase';

const queryBuilderFor = (orders: Orders[]) => {
  const builder: Record<string, jest.Mock> = {};
  for (const method of [
    'leftJoinAndSelect',
    'innerJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'take',
  ]) {
    builder[method] = jest.fn(() => builder);
  }
  builder.getMany = jest.fn().mockResolvedValue(orders);
  return builder;
};

describe('GetHotspotsUseCase', () => {
  const commonService = {
    getLoggedInUser: jest.fn().mockResolvedValue({ id: 'user_1' }),
  };

  it('returns no cross-city fallback when the rider location is stale', async () => {
    const ordersRepository = { createQueryBuilder: jest.fn() };
    const riderRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'rider_1',
        userId: 'user_1',
        currentLatitude: 9.0153312,
        currentLongitude: 7.568101,
        lastLocationUpdate: new Date(Date.now() - 10 * 60_000),
      }),
    };
    const useCase = new GetHotspotsUseCase(
      ordersRepository as never,
      riderRepository as never,
      commonService as never,
    );

    const response = await useCase.execute();

    expect(response.toJSON()).toMatchObject({
      error: false,
      data: { hotspots: [], locationStatus: 'unavailable' },
    });
    expect(ordersRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns only coordinate-bearing results from the local spatial queries', async () => {
    const localOrder = {
      id: 'order_1',
      status: 'PENDING',
      createdAt: new Date(),
      pickUpLocationAddress: 'Karu, Ado',
      pickUpLocation: {
        id: 'pickup_1',
        latitude: '9.02',
        longitude: '7.57',
      },
    } as unknown as Orders;
    const localQuery = queryBuilderFor([localOrder]);
    const ordersRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(localQuery),
    };
    const riderRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'rider_1',
        userId: 'user_1',
        currentLatitude: 9.0153312,
        currentLongitude: 7.568101,
        lastLocationUpdate: new Date(),
      } as Rider),
    };
    const useCase = new GetHotspotsUseCase(
      ordersRepository as never,
      riderRepository as never,
      commonService as never,
    );

    const response = await useCase.execute();

    expect(response.toJSON()).toMatchObject({
      data: {
        hotspots: [
          expect.objectContaining({
            id: 'pickup_1',
            name: 'Karu, Ado',
            latitude: 9.02,
            longitude: 7.57,
          }),
        ],
        locationStatus: 'fresh',
      },
    });
    expect(localQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('ST_DWithin'),
      expect.objectContaining({
        riderLatitude: 9.0153312,
        riderLongitude: 7.568101,
        radiusMeters: 18000,
      }),
    );
  });

  it('returns an empty local result instead of historical locations elsewhere', async () => {
    const ordersRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilderFor([])),
    };
    const riderRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'rider_1',
        userId: 'user_1',
        currentLatitude: 9.0153312,
        currentLongitude: 7.568101,
        lastLocationUpdate: new Date(),
      }),
    };
    const useCase = new GetHotspotsUseCase(
      ordersRepository as never,
      riderRepository as never,
      commonService as never,
    );

    expect((await useCase.execute()).toJSON()).toMatchObject({
      data: { hotspots: [], locationStatus: 'fresh' },
    });
  });
});

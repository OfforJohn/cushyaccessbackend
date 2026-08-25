/// <reference types="jest" />

import { FavoriteStoreService } from './favorite-store.service';

describe('FavoriteStoreService', () => {
  const createHarness = () => {
    const execute = jest.fn(async () => ({}));
    const insertBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute,
    };
    const storeBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => ({ id: 'store-id' })),
    };
    const favoriteBuilder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => [
        {
          store: {
            id: 'store-id',
            userId: 'vendor-id',
            name: 'Saved Pharmacy',
            coverImage: 'https://example.com/store.jpg',
            category: 'med_tech',
            address: { address: 'Minna, Niger' },
            isVisible: true,
            isFeatured: false,
            featuredAt: null,
          },
        },
      ]),
    };
    const favoriteRepository = {
      createQueryBuilder: jest.fn((alias?: string) =>
        alias === 'favorite' ? favoriteBuilder : insertBuilder,
      ),
      existsBy: jest.fn(async () => true),
      delete: jest.fn(async () => ({ affected: 1 })),
    };
    const storeRepository = {
      createQueryBuilder: jest.fn(() => storeBuilder),
    };
    const commonService = {
      getLoggedInUser: jest.fn(async () => ({ id: 'user-id' })),
    };
    const storeService = {
      attachOpeningSchedules: jest.fn(async (stores) => stores),
    };
    const service = new FavoriteStoreService(
      favoriteRepository as never,
      storeRepository as never,
      commonService as never,
      storeService as never,
    );
    return {
      service,
      favoriteRepository,
      insertBuilder,
      execute,
      storeService,
    };
  };

  it('adds a store idempotently using the unique user/store key', async () => {
    const { service, insertBuilder, execute } = createHarness();

    const response = await service.add('store-id');

    expect(insertBuilder.values).toHaveBeenCalledWith({
      userId: 'user-id',
      storeId: 'store-id',
    });
    expect(insertBuilder.orIgnore).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((response as unknown as { data: object }).data).toEqual({
      storeId: 'store-id',
      isFavorite: true,
    });
  });

  it('removes only the current user/store favourite', async () => {
    const { service, favoriteRepository } = createHarness();

    const response = await service.remove('store-id');

    expect(favoriteRepository.delete).toHaveBeenCalledWith({
      userId: 'user-id',
      storeId: 'store-id',
    });
    expect((response as unknown as { data: object }).data).toEqual({
      storeId: 'store-id',
      isFavorite: false,
    });
  });

  it('returns the persisted favourite status', async () => {
    const { service, favoriteRepository } = createHarness();

    const response = await service.status('store-id');

    expect(favoriteRepository.existsBy).toHaveBeenCalledWith({
      userId: 'user-id',
      storeId: 'store-id',
    });
    expect(
      (response as unknown as { data: { isFavorite: boolean } }).data
        .isFavorite,
    ).toBe(true);
  });

  it('returns saved stores with customer card and availability fields', async () => {
    const { service, storeService } = createHarness();
    storeService.attachOpeningSchedules.mockImplementation(async (stores) =>
      stores.map((store) => ({
        ...store,
        isOpen: false,
        isOrderable: false,
        availabilityStatus: 'OUTSIDE_OPERATING_HOURS',
        availabilityLabel: 'Re-opens Friday by 8AM',
        nextOpeningLabel: 'Friday by 8AM',
        orderDisabledReason: 'OUTSIDE_OPERATING_HOURS',
      })),
    );

    const response = await service.list();
    const data = (
      response as unknown as { data: Array<Record<string, unknown>> }
    ).data;

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      id: 'store-id',
      name: 'Saved Pharmacy',
      category: 'med_tech',
      location: 'Minna, Niger',
      isOrderable: false,
      availabilityLabel: 'Re-opens Friday by 8AM',
    });
  });
});

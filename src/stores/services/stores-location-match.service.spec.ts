import { StoreService } from './stores.service';
import { UserCredentialStatus } from '../../users/model/user-credential.enum';

describe('StoreService location matching', () => {
  const service = Object.create(StoreService.prototype) as any;

  it.each([
    ['Minna', 'niger'],
    ['Niger State', 'minna'],
    ['Federal Capital Territory', 'fct'],
    ['Utako', 'abuja'],
    ['Ilorin', 'kwara'],
  ])('maps %s to the %s service-area aliases', (input, expectedAlias) => {
    expect(service.getStateSearchAliases(input)).toContain(expectedAlias);
  });

  it('normalizes unknown state names without broad substring matching', () => {
    expect(service.getStateSearchAliases('  Nasarawa State ')).toEqual([
      'nasarawa state',
      'nasarawa',
    ]);
  });

  it('matches both normalized state fields and formatted addresses', async () => {
    const queryBuilder: any = {
      leftJoinAndSelect: jest.fn(),
      loadRelationCountAndMap: jest.fn(),
      innerJoin: jest.fn(),
      andWhere: jest.fn(),
      groupBy: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    for (const method of Object.values(queryBuilder) as any[]) {
      if (method?.mockReturnValue && method !== queryBuilder.getMany) {
        method.mockReturnValue(queryBuilder);
      }
    }
    service.storeRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    service.attachOpeningSchedules = jest.fn(
      async (stores: unknown[]) => stores,
    );

    await service.findStoresByState('Minna');

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('LOWER(TRIM(address.state))'),
      expect.objectContaining({
        stateAliases: expect.arrayContaining(['niger', 'minna', 'suleja']),
        statePattern: expect.stringContaining('minna'),
      }),
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'user.verificationStatus = :approvedStatus',
      { approvedStatus: UserCredentialStatus.APPROVED },
    );
    expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
      expect.stringContaining('store.coverImage'),
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('EXISTS (SELECT 1 FROM menu_item'),
    );
    expect(queryBuilder.innerJoin).not.toHaveBeenCalledWith(
      'store.menuItems',
      'menuItem',
    );
    expect(queryBuilder.groupBy).not.toHaveBeenCalled();
  });

  it('uses the indexed city key and only falls back for historical rows', async () => {
    const queryBuilder: any = {
      leftJoinAndSelect: jest.fn(),
      innerJoin: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      groupBy: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    for (const method of Object.values(queryBuilder) as any[]) {
      if (method?.mockReturnValue && method !== queryBuilder.getMany) {
        method.mockReturnValue(queryBuilder);
      }
    }
    service.storeRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    service.attachOpeningSchedules = jest.fn(
      async (stores: unknown[]) => stores,
    );

    await service.findStoresByCity(' Minna ');

    expect(queryBuilder.where).toHaveBeenCalledWith(
      expect.stringContaining('address.city = :cleanCity'),
      expect.objectContaining({
        cleanCity: 'minna',
        cityPattern: expect.stringContaining('minna'),
      }),
    );
    expect(queryBuilder.where).toHaveBeenCalledWith(
      expect.stringContaining('address.city IS NULL'),
      expect.any(Object),
    );
  });

  it('does not broaden a structured city to unrelated stores in the state', async () => {
    service.validateAccessKey = jest.fn().mockResolvedValue({
      location: {
        city: 'minna',
        state: 'Niger',
        address: 'Bosso Road, Minna, Niger, Nigeria',
      },
    });
    service.findStoresByCity = jest.fn().mockResolvedValue([]);
    service.findStoresByState = jest
      .fn()
      .mockResolvedValue([{ id: 'store-in-another-city' }]);

    const response = await service.getStores(undefined, 'Bearer valid-token');

    expect(response.toJSON()).toMatchObject({
      error: true,
      message: 'WE_HAVE_NOT_LAUNCHED_IN_MINNA_YET',
      data: [],
    });
    expect(service.findStoresByState).not.toHaveBeenCalled();
  });

  it('uses the structured city as the authoritative search scope', async () => {
    service.validateAccessKey = jest.fn().mockResolvedValue({
      location: {
        city: 'minna',
        state: 'Niger',
        address: 'Bosso Road, Minna, Niger, Nigeria',
      },
    });
    service.findCustomerStoreIdsByCity = jest.fn().mockResolvedValue([]);
    service.findCustomerStoreIdsByState = jest
      .fn()
      .mockResolvedValue(['store_suleja']);

    await expect(
      service.getCustomerDiscoveryStoreIds('Bearer valid-token'),
    ).resolves.toEqual([]);
    expect(service.findCustomerStoreIdsByCity).toHaveBeenCalledWith('minna');
    expect(service.findCustomerStoreIdsByState).not.toHaveBeenCalled();
  });

  it('only falls back to state for a historical location without a city key', async () => {
    service.validateAccessKey = jest.fn().mockResolvedValue({
      location: {
        city: null,
        state: 'Niger',
        address: 'Bosso Road, Minna, Niger, Nigeria',
      },
    });
    service.extractCityFromAddress = jest.fn().mockResolvedValue('minna');
    service.findCustomerStoreIdsByCity = jest.fn().mockResolvedValue([]);
    service.findCustomerStoreIdsByState = jest
      .fn()
      .mockResolvedValue(['store_suleja']);

    await expect(
      service.getCustomerDiscoveryStoreIds('Bearer valid-token'),
    ).resolves.toEqual(['store_suleja']);
    expect(service.findCustomerStoreIdsByState).toHaveBeenCalledWith('Niger');
  });

  it('keeps popular search available until a location is selected', async () => {
    service.validateAccessKey = jest.fn().mockResolvedValue({ location: null });

    await expect(
      service.getCustomerDiscoveryStoreIds('Bearer valid-token'),
    ).resolves.toBeNull();
  });
});

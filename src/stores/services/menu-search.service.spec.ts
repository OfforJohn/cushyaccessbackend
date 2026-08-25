import { StoreCategory } from '../model/enums/store.category';
import { UserCredentialStatus } from '../../users/model/user-credential.enum';
import { MenuItemService } from './menu-item.service';

describe('MenuItemService discovery search', () => {
  const createQueryBuilder = () => {
    const builder: any = {
      innerJoin: jest.fn(),
      innerJoinAndSelect: jest.fn(),
      leftJoinAndSelect: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      take: jest.fn(),
      getMany: jest.fn(),
    };
    Object.values(builder).forEach((value: any) => {
      if (value?.mockReturnValue && value !== builder.getMany) {
        value.mockReturnValue(builder);
      }
    });
    return builder;
  };
  const itemQueryBuilder = createQueryBuilder();
  const storeQueryBuilder = createQueryBuilder();
  const itemRepository = {
    createQueryBuilder: jest.fn(() => itemQueryBuilder),
  };
  const storeRepository = {
    createQueryBuilder: jest.fn(() => storeQueryBuilder),
  };
  const storeService = {
    getCustomerDiscoveryStoreIds: jest.fn().mockResolvedValue(null),
    getCustomerDiscoveryScopeForUser: jest.fn().mockResolvedValue({
      eligibleStoreIds: null,
      selectedLocation: null,
    }),
    getStoreAvailability: jest.fn(() => ({
      isOpen: true,
      isOrderable: true,
      isWithinOperatingHours: true,
      availabilityStatus: 'OPEN',
      availabilityLabel: 'Open',
      nextOpeningLabel: null,
      orderDisabledReason: null,
    })),
  };
  const service = new MenuItemService(
    itemRepository as never,
    storeRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    storeService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    itemRepository.createQueryBuilder.mockReturnValue(itemQueryBuilder);
    storeRepository.createQueryBuilder.mockReturnValue(storeQueryBuilder);
    itemQueryBuilder.getMany.mockResolvedValue([]);
    storeQueryBuilder.getMany.mockResolvedValue([]);
    storeService.getCustomerDiscoveryStoreIds.mockResolvedValue(null);
    storeService.getCustomerDiscoveryScopeForUser.mockResolvedValue({
      eligibleStoreIds: null,
      selectedLocation: null,
    });
  });

  it('does not query the database for fewer than two characters', async () => {
    const response = await service.searchDiscovery(' a ');

    expect(itemRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(storeRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(response.toJSON().data).toEqual([]);
  });

  it('groups matching items beneath their merchant', async () => {
    itemQueryBuilder.getMany.mockResolvedValue([
      {
        id: 'item_1',
        storeId: 'store_1',
        menuCategoryId: 'category_1',
        name: 'Jollof Rice',
        description: 'Smoky party rice',
        images: ['https://example.com/rice.jpg'],
        price: 2500,
        isAvailable: true,
        isDiscountActive: false,
        discountPrice: null,
        discountPercentage: null,
        store: {
          id: 'store_1',
          name: 'Mama Foods',
          category: StoreCategory.RESTAURANT,
          isVisible: true,
          isSuspended: false,
          address: { address: 'Lagos' },
          openingSchedules: { schedules: [] },
        },
      },
    ]);

    const response = await service.searchDiscovery(
      'Jollof',
      StoreCategory.RESTAURANT,
    );

    expect(response.toJSON().data).toEqual([
      expect.objectContaining({
        store: expect.objectContaining({
          id: 'store_1',
          name: 'Mama Foods',
        }),
        matchedItems: [
          expect.objectContaining({ id: 'item_1', name: 'Jollof Rice' }),
        ],
      }),
    ]);
    expect(itemQueryBuilder.andWhere).toHaveBeenCalledWith(
      'store.category = :category',
      { category: StoreCategory.RESTAURANT },
    );
    expect(storeQueryBuilder.andWhere).toHaveBeenCalledWith(
      'store.category = :category',
      { category: StoreCategory.RESTAURANT },
    );
    expect(storeQueryBuilder.andWhere).toHaveBeenCalledWith(
      'vendor.verificationStatus = :approvedStatus',
      { approvedStatus: UserCredentialStatus.APPROVED },
    );
    expect(itemQueryBuilder.andWhere).toHaveBeenCalledWith(
      'vendor.verificationStatus = :approvedStatus',
      { approvedStatus: UserCredentialStatus.APPROVED },
    );
  });

  it('searches several AI recommendation terms with one scoped query pair', async () => {
    storeService.getCustomerDiscoveryScopeForUser.mockResolvedValue({
      eligibleStoreIds: ['far_store', 'near_store'],
      selectedLocation: {
        city: 'Minna',
        state: 'Niger',
        latitude: '9',
        longitude: '7',
      },
    });
    itemQueryBuilder.getMany.mockResolvedValue([
      {
        id: 'far_item',
        storeId: 'far_store',
        name: 'Grilled fish',
        price: 3000,
        isAvailable: true,
        store: {
          id: 'far_store',
          name: 'Far Kitchen',
          address: { address: 'Far away', latitude: '10', longitude: '7' },
        },
      },
      {
        id: 'near_item',
        storeId: 'near_store',
        name: 'Garden salad',
        price: 1800,
        isAvailable: true,
        store: {
          id: 'near_store',
          name: 'Near Kitchen',
          address: { address: 'Nearby', latitude: '9.01', longitude: '7' },
        },
      },
    ]);

    const result = await service.searchDiscoveryTermsWithScopeForUser(
      ['grilled chicken', 'grilled fish', 'salad', 'salad'],
      'customer_1',
      StoreCategory.RESTAURANT,
    );

    expect(storeService.getCustomerDiscoveryScopeForUser).toHaveBeenCalledTimes(
      1,
    );
    expect(itemRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(storeRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(itemQueryBuilder.where).toHaveBeenCalledWith(
      expect.stringContaining('term2'),
      {
        term0: '%grilled chicken%',
        term1: '%grilled fish%',
        term2: '%salad%',
      },
    );
    expect(result.selectedLocation).toEqual({
      city: 'Minna',
      state: 'Niger',
      latitude: '9',
      longitude: '7',
    });
    expect(result.response.toJSON().data[0].store).toEqual(
      expect.objectContaining({
        id: 'near_store',
        distanceKm: expect.any(Number),
      }),
    );
  });

  it('returns a finite distance for valid extreme coordinates', async () => {
    storeService.getCustomerDiscoveryScopeForUser.mockResolvedValue({
      eligibleStoreIds: ['antipodal_store'],
      selectedLocation: { latitude: '90', longitude: '0' },
    });
    itemQueryBuilder.getMany.mockResolvedValue([
      {
        id: 'extreme_item',
        storeId: 'antipodal_store',
        name: 'Rice',
        price: 1000,
        isAvailable: true,
        store: {
          id: 'antipodal_store',
          name: 'Antipodal Kitchen',
          address: { address: 'Far away', latitude: '-90', longitude: '180' },
        },
      },
    ]);

    const result = await service.searchDiscoveryWithScopeForUser(
      'rice',
      'customer_1',
    );
    const distance = result.response.toJSON().data[0].store.distanceKm;

    expect(Number.isFinite(distance)).toBe(true);
    expect(distance).toBeGreaterThan(20_000);
  });

  it('returns merchant-name matches even when no product name matches', async () => {
    storeQueryBuilder.getMany.mockResolvedValue([
      {
        id: 'store_2',
        name: 'Healthy Pharmacy',
        category: StoreCategory.MED_TECH,
        isVisible: true,
        isSuspended: false,
        address: { address: 'Abuja' },
        openingSchedules: { schedules: [] },
      },
    ]);

    const response = await service.searchDiscovery('Healthy');

    expect(response.toJSON().data).toEqual([
      expect.objectContaining({
        store: expect.objectContaining({
          id: 'store_2',
          name: 'Healthy Pharmacy',
        }),
        matchedItems: [],
      }),
    ]);
  });

  it('restricts merchant and product matches to the selected location', async () => {
    storeService.getCustomerDiscoveryStoreIds.mockResolvedValue([
      'store_minna',
    ]);

    await service.searchDiscovery(
      'Rice',
      StoreCategory.RESTAURANT,
      'Bearer customer-token',
    );

    expect(storeService.getCustomerDiscoveryStoreIds).toHaveBeenCalledWith(
      'Bearer customer-token',
    );
    expect(storeQueryBuilder.andWhere).toHaveBeenCalledWith(
      'store.id IN (:...eligibleStoreIds)',
      { eligibleStoreIds: ['store_minna'] },
    );
    expect(itemQueryBuilder.andWhere).toHaveBeenCalledWith(
      'store.id IN (:...eligibleStoreIds)',
      { eligibleStoreIds: ['store_minna'] },
    );
  });

  it('does not run nationwide search queries for an unsupported location', async () => {
    storeService.getCustomerDiscoveryStoreIds.mockResolvedValue([]);

    const response = await service.searchDiscovery(
      'Rice',
      undefined,
      'Bearer customer-token',
    );

    expect(response.toJSON().data).toEqual([]);
    expect(itemRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(storeRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('never gives AI a nationwide fallback when the user has no selected location', async () => {
    const response = await service.searchDiscoveryForUser(
      'Rice',
      'customer_without_location',
    );

    expect(storeService.getCustomerDiscoveryScopeForUser).toHaveBeenCalledWith(
      'customer_without_location',
    );
    expect(response.toJSON().message).toBe('SEARCH_LOCATION_REQUIRED');
    expect(response.toJSON().data).toEqual([]);
    expect(itemRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(storeRepository.createQueryBuilder).not.toHaveBeenCalled();
  });
});

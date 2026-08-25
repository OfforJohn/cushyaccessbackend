import { BadRequestException } from '@nestjs/common';
import { UserCredentialStatus } from '../../users/model/user-credential.enum';
import { StoreMapper } from './stores.mapper';
import { StoreService } from './stores.service';

describe('StoreService featured merchants', () => {
  const repository = {
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const service = Object.create(StoreService.prototype) as any;
  service.storeRepository = repository;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('features an eligible store idempotently and exposes it through the list mapper', async () => {
    const store: any = {
      id: 'store_1',
      userId: 'vendor_1',
      name: 'Cushy Kitchen',
      coverImage: 'cover.jpg',
      category: 'restaurant',
      isVerified: true,
      isSuspended: false,
      isVisible: true,
      isFeatured: false,
      user: { verificationStatus: UserCredentialStatus.APPROVED },
      address: { address: 'Wuse, Abuja' },
    };
    repository.findOne.mockImplementation(async () => store);
    repository.update.mockImplementation(async (where, update) => {
      if (
        where.isFeatured === false &&
        store.isFeatured === false &&
        store.isVerified &&
        !store.isSuspended
      ) {
        Object.assign(store, update);
        return { affected: 1 };
      }
      return { affected: 0 };
    });

    const response = await service.setFeaturedStore('store_1', true);
    const mapped = new StoreMapper().mapStoreList(store);

    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(store.isFeatured).toBe(true);
    expect(store.featuredAt).toBeInstanceOf(Date);
    expect(mapped.isFeatured).toBe(true);
    expect(response.toJSON().error).toBe(false);

    const featuredAt = store.featuredAt;
    await service.setFeaturedStore('store_1', true);
    expect(repository.update).toHaveBeenCalledTimes(2);
    expect(store.featuredAt).toBe(featuredAt);
  });

  it('does not feature an unverified or suspended store', async () => {
    repository.findOne.mockResolvedValue({
      id: 'store_2',
      isVerified: false,
      isSuspended: false,
      isFeatured: false,
      user: { verificationStatus: UserCredentialStatus.PENDING },
    });

    await expect(service.setFeaturedStore('store_2', true)).rejects.toThrow(
      BadRequestException,
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('cannot re-feature a store that is suspended during the request', async () => {
    const store = {
      id: 'store_3',
      isVerified: true,
      isSuspended: false,
      isFeatured: false,
      user: { verificationStatus: UserCredentialStatus.APPROVED },
    };
    repository.findOne.mockImplementation(async () => store);
    repository.update.mockImplementation(async () => {
      store.isSuspended = true;
      return { affected: 0 };
    });

    await expect(service.setFeaturedStore('store_3', true)).rejects.toThrow(
      BadRequestException,
    );
    expect(store.isFeatured).toBe(false);
  });

  it('repairs a legacy store flag only for an explicitly approved vendor', async () => {
    const store: any = {
      id: 'store_legacy',
      isVerified: false,
      isSuspended: false,
      isFeatured: false,
      user: { verificationStatus: UserCredentialStatus.APPROVED },
    };
    repository.findOne.mockImplementation(async () => store);
    repository.update.mockImplementation(async (_where, update) => {
      Object.assign(store, update);
      return { affected: 1 };
    });

    const response = await service.setFeaturedStore('store_legacy', true);

    expect(repository.update).toHaveBeenNthCalledWith(
      1,
      { id: 'store_legacy', isSuspended: false },
      { isVerified: true },
    );
    expect(store.isVerified).toBe(true);
    expect(store.isFeatured).toBe(true);
    expect(response.toJSON().error).toBe(false);
  });

  it('does not feature a store when KYC is revoked during the request', async () => {
    const store: any = {
      id: 'store_revoked',
      isVerified: true,
      isSuspended: false,
      isFeatured: false,
      user: { verificationStatus: UserCredentialStatus.APPROVED },
    };
    let reads = 0;
    repository.findOne.mockImplementation(async () => {
      reads += 1;
      if (reads === 2) {
        store.user.verificationStatus = UserCredentialStatus.REJECTED;
      }
      return store;
    });
    repository.update.mockImplementation(async (_where, update) => {
      Object.assign(store, update);
      return { affected: 1 };
    });

    await expect(
      service.setFeaturedStore('store_revoked', true),
    ).rejects.toThrow(BadRequestException);

    expect(store.isVerified).toBe(false);
    expect(store.isFeatured).toBe(false);
    expect(store.featuredAt).toBeNull();
  });

  it('does not label cross-location popular stores as Featured without a customer location', async () => {
    jest.spyOn(service, 'validateAccessKey').mockResolvedValue(null);
    jest.spyOn(service, 'findAllStores').mockResolvedValue([
      {
        id: 'store_minna',
        userId: 'vendor_2',
        name: 'Minna Meals',
        coverImage: 'cover.jpg',
        category: 'restaurant',
        isVisible: true,
        isFeatured: true,
        featuredAt: new Date(),
        address: { address: 'Minna, Niger' },
      },
    ]);

    const response = await service.getStores();

    expect(response.toJSON().data[0]).toEqual(
      expect.objectContaining({
        id: 'store_minna',
        isFeatured: false,
        featuredAt: null,
      }),
    );
  });

  it('strips Featured status when a saved location cannot be localized', async () => {
    jest.spyOn(service, 'validateAccessKey').mockResolvedValue({
      id: 'customer_1',
      location: {
        address: 'Unmapped delivery area',
        state: null,
      },
    });
    jest.spyOn(service, 'findAllStores').mockResolvedValue([
      {
        id: 'store_minna',
        userId: 'vendor_2',
        name: 'Minna Meals',
        coverImage: 'cover.jpg',
        category: 'restaurant',
        isVisible: true,
        isFeatured: true,
        featuredAt: new Date(),
        address: { address: 'Minna, Niger' },
      },
    ]);

    const response = await service.getStores();

    expect(response.toJSON().data[0]).toEqual(
      expect.objectContaining({
        isFeatured: false,
        featuredAt: null,
      }),
    );
  });

  it('does not treat short city aliases as substrings inside street names', async () => {
    await expect(
      service.extractCityFromAddress('Davis Street'),
    ).resolves.toBeNull();
  });
});

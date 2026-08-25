import * as bcrypt from 'bcryptjs';
import { StoreMenuImportService } from './store-menu-import.service';
import { Stores } from '../model/stores.entity';
import { MenuCategory } from '../model/menu-category.entity';
import { MenuPack } from '../model/menu-pack.entity';
import { MenuOptionGroup } from '../model/menu-option-group.entity';
import { MenuItem } from '../model/menu-item.entity';
import { Cart } from '../../orders/model/cart.entity';

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (value: string) => `hash:${value}`),
  compare: jest.fn(
    async (value: string, hash: string) => hash === `hash:${value}`,
  ),
}));

describe('StoreMenuImportService', () => {
  it('rejects a missing source id without querying an arbitrary owned store', async () => {
    const storeRepository = {
      findOne: jest.fn(),
      manager: {},
    };
    const service = new StoreMenuImportService(
      storeRepository as any,
      {
        getLoggedInUser: jest.fn(),
      } as any,
    );

    await expect(
      service.preview(undefined as any, 'str_target'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'SOURCE_AND_TARGET_STORE_REQUIRED',
      }),
    });
    expect(storeRepository.findOne).not.toHaveBeenCalled();
  });

  it('refuses an empty source before deleting anything from the receiver', async () => {
    const targetHash = await bcrypt.hash('target-secret', 4);
    const stores = [
      {
        id: 'str_source',
        userId: 'usr_vendor',
        category: 'restaurant',
      },
      {
        id: 'str_target',
        userId: 'usr_vendor',
        category: 'restaurant',
        branchPasswordHash: targetHash,
      },
    ];
    const storeQuery = {
      addSelect: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(stores),
    };
    const manager = {
      query: jest.fn().mockResolvedValue([{ acquired: true }]),
      getRepository: jest.fn((entity) =>
        entity === Stores
          ? { createQueryBuilder: jest.fn(() => storeQuery) }
          : {},
      ),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
    };
    const storeRepository = {
      manager: {
        transaction: jest.fn(async (_isolation, work) => work(manager)),
      },
    };
    const service = new StoreMenuImportService(
      storeRepository as any,
      {
        getLoggedInUser: jest.fn().mockResolvedValue({ id: 'usr_vendor' }),
      } as any,
    );

    await expect(
      service.import('str_target', {
        sourceStoreId: 'str_source',
        password: 'target-secret',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ message: 'SOURCE_STORE_MENU_EMPTY' }),
    });
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('does not allow a merchant to use the same store as source and receiver', async () => {
    const storeRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'str_one',
        userId: 'usr_vendor',
        category: 'restaurant',
      }),
      manager: {},
    };
    const service = new StoreMenuImportService(
      storeRepository as any,
      {
        getLoggedInUser: jest.fn().mockResolvedValue({ id: 'usr_vendor' }),
      } as any,
    );

    await expect(service.preview('str_one', 'str_one')).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'SOURCE_AND_TARGET_STORE_MUST_DIFFER',
      }),
    });
  });

  it('copies the complete catalogue, clears stale carts, and never mutates orders', async () => {
    const targetHash = await bcrypt.hash('target-secret', 4);
    const sourcePack = {
      id: 'mp_source',
      userId: 'usr_vendor',
      storeId: 'str_source',
      name: 'Regular pack',
      isPublished: true,
    };
    const sourceCategory = {
      id: 'mcg_source',
      userId: 'usr_vendor',
      storeId: 'str_source',
      name: 'Meals',
      normalizedName: ' stale legacy value ',
      isPublished: true,
    };
    const sourceGroup = {
      id: 'mog_source',
      userId: 'usr_vendor',
      storeId: 'str_source',
      name: 'Protein',
      normalizedName: 'protein',
      isPublished: true,
      isRequired: false,
      allowMultiple: false,
      choices: [{ id: 'moc_one', name: 'Chicken', priceAdjustment: 500 }],
    };
    const sourceItem = {
      id: 'mit_source',
      storeId: 'str_source',
      menuCategoryId: 'mcg_source',
      menuPack: sourcePack,
      name: 'Jollof rice',
      description: 'Smoky rice',
      images: ['https://cdn.example/menu.jpg'],
      price: 2500,
      isAvailable: true,
      isDiscountActive: false,
      discountPrice: null,
      discountPercentage: null,
      discountStart: null,
      discountEnd: null,
      optionGroupIds: ['mog_source'],
    };
    const historicalPack = {
      id: 'mp_historical',
      userId: 'usr_vendor',
      storeId: 'str_target',
      name: 'Old historical pack',
      isPublished: true,
    };
    const storeQuery = {
      addSelect: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'str_source',
          userId: 'usr_vendor',
          category: 'restaurant',
        },
        {
          id: 'str_target',
          userId: 'usr_vendor',
          category: 'restaurant',
          branchPasswordHash: targetHash,
        },
      ]),
    };
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes('pg_try_advisory')
          ? [{ acquired: true }]
          : [{ menuPackId: historicalPack.id }],
      ),
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => storeQuery),
      })),
      find: jest.fn(async (entity: unknown, options: any) => {
        if (entity === MenuCategory) return [sourceCategory];
        if (entity === MenuOptionGroup) return [sourceGroup];
        if (entity === MenuItem) return [sourceItem];
        if (entity === MenuPack && options.where.storeId === 'str_source')
          return [sourcePack];
        if (entity === MenuPack) return [historicalPack];
        return [];
      }),
      count: jest
        .fn()
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1),
      delete: jest.fn(),
      update: jest.fn(),
      create: jest.fn((_entity, value) => value),
      save: jest.fn(async (_entity, value) => value),
    };
    const storeRepository = {
      manager: {
        transaction: jest.fn(async (_isolation, work) => work(manager)),
      },
    };
    const service = new StoreMenuImportService(
      storeRepository as any,
      {
        getLoggedInUser: jest.fn().mockResolvedValue({ id: 'usr_vendor' }),
      } as any,
    );

    const response = await service.import('str_target', {
      sourceStoreId: 'str_source',
      password: 'target-secret',
    });

    expect((response as any).data).toEqual(
      expect.objectContaining({
        productsCopied: 1,
        targetProductsReplaced: 2,
        cartsCleared: 1,
      }),
    );
    expect(manager.delete).toHaveBeenCalledWith(Cart, {
      storeId: 'str_target',
    });
    expect(manager.delete).toHaveBeenCalledWith(MenuItem, {
      storeId: 'str_target',
    });
    const itemSave = manager.save.mock.calls.find(
      ([entity]) => entity === MenuItem,
    );
    const categorySave = manager.save.mock.calls.find(
      ([entity]) => entity === MenuCategory,
    );
    expect(categorySave?.[1][0]).toEqual(
      expect.objectContaining({ normalizedName: 'meals' }),
    );
    expect(itemSave?.[1][0]).toEqual(
      expect.objectContaining({
        storeId: 'str_target',
        images: ['https://cdn.example/menu.jpg'],
        price: 2500,
      }),
    );
    expect(manager.update).toHaveBeenCalledWith(
      MenuPack,
      expect.objectContaining({ id: expect.any(Object) }),
      { isPublished: false },
    );
    expect(
      manager.delete.mock.calls.some(([entity]) => entity === 'order_items'),
    ).toBe(false);
  });
});

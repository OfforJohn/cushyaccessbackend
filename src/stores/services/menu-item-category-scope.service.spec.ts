import { NotFoundException } from '@nestjs/common';
import { MenuItemService } from './menu-item.service';

describe('MenuItemService category scoping', () => {
  it('rejects a category that does not belong to the selected store', async () => {
    const menuItemRepository = {
      findOne: jest.fn().mockResolvedValue(undefined),
      save: jest.fn(),
    };
    const menuCategoryService = {
      existingByIdStoreAndVendorId: jest.fn().mockResolvedValue(false),
    };
    const storeService = {
      existingByStoreIdAndVendorId: jest.fn().mockResolvedValue(true),
    };
    const service = new MenuItemService(
      menuItemRepository as never,
      {} as never,
      {} as never,
      {
        getLoggedInUser: jest.fn().mockResolvedValue({ id: 'vendor_1' }),
      } as never,
      menuCategoryService as never,
      {} as never,
      storeService as never,
    );

    await expect(
      service.createMenuItem('store_2', {
        menuCategoryId: 'mcg_store_1',
        name: 'Jollof rice',
        price: 2500,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(
      menuCategoryService.existingByIdStoreAndVendorId,
    ).toHaveBeenCalledWith('mcg_store_1', 'store_2', 'vendor_1');
    expect(menuItemRepository.save).not.toHaveBeenCalled();
  });

  it('applies the same exact category scope when editing a meal', async () => {
    const menuItemRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'meal_2',
        storeId: 'store_2',
        menuCategoryId: 'mcg_store_2',
      }),
      save: jest.fn(),
    };
    const menuCategoryService = {
      existingByIdStoreAndVendorId: jest.fn().mockResolvedValue(false),
    };
    const storeService = {
      existingByStoreIdAndVendorId: jest.fn().mockResolvedValue(true),
    };
    const service = new MenuItemService(
      menuItemRepository as never,
      {} as never,
      {} as never,
      {
        getLoggedInUser: jest.fn().mockResolvedValue({ id: 'vendor_1' }),
      } as never,
      menuCategoryService as never,
      {} as never,
      storeService as never,
    );

    await expect(
      service.updateMenuItem('store_2', 'meal_2', {
        menuCategoryId: 'mcg_store_1',
        name: 'Jollof rice',
        price: 2500,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(
      menuCategoryService.existingByIdStoreAndVendorId,
    ).toHaveBeenCalledWith('mcg_store_1', 'store_2', 'vendor_1');
    expect(menuItemRepository.save).not.toHaveBeenCalled();
  });
});

import { BadRequestException } from '@nestjs/common';
import { MenuCategoryService } from './menu-category.service';

describe('MenuCategoryService multi-store scoping', () => {
  const repository = {
    findOne: jest.fn(),
    create: jest.fn((value) => ({ id: 'mcg_new', ...value })),
    save: jest.fn(),
    exist: jest.fn(),
    remove: jest.fn(),
  };
  const commonService = {
    getLoggedInUser: jest.fn().mockResolvedValue({ id: 'vendor_1' }),
  };
  const storeService = {
    existingByStoreIdAndVendorId: jest.fn().mockResolvedValue(true),
  };
  const service = new MenuCategoryService(
    repository as never,
    commonService as never,
    storeService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findOne.mockResolvedValue(undefined);
    repository.save.mockResolvedValue(undefined);
    storeService.existingByStoreIdAndVendorId.mockResolvedValue(true);
  });

  it('allows the same normalized category name in a different store', async () => {
    const response = await service.createMenuCategory('store_2', {
      name: '  General  ',
      isPublished: true,
    });

    expect(repository.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({ storeId: 'store_2' }),
    });
    expect(repository.create).toHaveBeenCalledWith({
      storeId: 'store_2',
      userId: 'vendor_1',
      name: 'General',
      normalizedName: 'general',
      isPublished: true,
    });
    expect(response.toJSON().message).toBe(
      'MENU_CATEGORY_CREATED_SUCCESSFULLY',
    );
  });

  it('rejects a case-insensitive duplicate within the same store', async () => {
    repository.findOne.mockResolvedValue({
      id: 'mcg_existing',
      storeId: 'store_2',
      name: 'General',
    });

    await expect(
      service.createMenuCategory('store_2', {
        name: ' general ',
        isPublished: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only category name', async () => {
    await expect(
      service.createMenuCategory('store_2', {
        name: '   ',
        isPublished: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.findOne).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('maps a concurrent database uniqueness conflict to the API error', async () => {
    repository.save.mockRejectedValue({ code: '23505' });

    await expect(
      service.createMenuCategory('store_2', {
        name: 'General',
        isPublished: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('checks category identity, store and owner together', async () => {
    repository.exist.mockResolvedValue(true);

    await expect(
      service.existingByIdStoreAndVendorId(
        'mcg_store_2',
        'store_2',
        'vendor_1',
      ),
    ).resolves.toBe(true);
    expect(repository.exist).toHaveBeenCalledWith({
      where: {
        id: 'mcg_store_2',
        storeId: 'store_2',
        userId: 'vendor_1',
      },
    });
  });
});

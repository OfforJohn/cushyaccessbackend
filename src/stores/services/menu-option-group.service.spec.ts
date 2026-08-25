import { MenuOptionGroupService } from './menu-option-group.service';
import { MenuOptionGroup } from '../model/menu-option-group.entity';

describe('MenuOptionGroupService', () => {
  const execute = jest.fn();
  const setParameter = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ setParameter }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));
  const createQueryBuilder = jest.fn(() => ({ update }));
  const transactionalRepository = {
    findOne: jest.fn(),
    delete: jest.fn(),
  };
  const manager = {
    getRepository: jest.fn((entity) =>
      entity === MenuOptionGroup
        ? transactionalRepository
        : { createQueryBuilder },
    ),
    transaction: jest.fn((work) => work(manager)),
  };
  const repository = {
    create: jest.fn((value) => ({ id: 'mog_1', ...value })),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    manager,
  };
  const commonService = {
    getLoggedInUser: jest.fn().mockResolvedValue({ id: 'vendor_1' }),
  };
  const storeService = {
    existingByStoreIdAndVendorId: jest.fn().mockResolvedValue(true),
  };
  const service = new MenuOptionGroupService(
    repository as never,
    commonService as never,
    storeService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    commonService.getLoggedInUser.mockResolvedValue({ id: 'vendor_1' });
    storeService.existingByStoreIdAndVendorId.mockResolvedValue(true);
    repository.findOne.mockResolvedValue(undefined);
    transactionalRepository.findOne.mockResolvedValue(undefined);
    transactionalRepository.delete.mockResolvedValue({ affected: 1 });
    execute.mockResolvedValue({ affected: 1 });
  });

  it('rejects case-insensitive duplicates from pre-normalization rows', async () => {
    repository.findOne.mockResolvedValue({
      id: 'mog_existing',
      name: 'Toppings',
    });

    await expect(
      service.create('store_1', {
        name: ' toppings ',
        isPublished: true,
      }),
    ).rejects.toThrow('MENU_OPTION_GROUP_NAME_ALREADY_EXISTS');

    expect(repository.save).not.toHaveBeenCalled();
  });

  it('creates a normalized group scoped to the authenticated vendor store', async () => {
    repository.save.mockResolvedValue(undefined);

    const response = await service.create('store_1', {
      name: '  Toppings  ',
      isPublished: true,
    });

    expect(storeService.existingByStoreIdAndVendorId).toHaveBeenCalledWith(
      'store_1',
      'vendor_1',
    );
    expect(repository.create).toHaveBeenCalledWith({
      storeId: 'store_1',
      userId: 'vendor_1',
      name: 'Toppings',
      normalizedName: 'toppings',
      isPublished: true,
      isRequired: false,
      allowMultiple: false,
      choices: [],
    });
    expect(response.toJSON().error).toBe(false);
  });

  it('normalizes choices and generates stable choice identifiers', async () => {
    repository.save.mockResolvedValue(undefined);

    await service.create('store_1', {
      name: 'Size',
      isPublished: true,
      isRequired: true,
      choices: [
        { name: ' Regular ', priceAdjustment: 0 },
        { name: 'Large', priceAdjustment: 500 },
      ],
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        isRequired: true,
        choices: [
          expect.objectContaining({ name: 'Regular', priceAdjustment: 0 }),
          expect.objectContaining({ name: 'Large', priceAdjustment: 500 }),
        ],
      }),
    );
  });

  it('rejects a required group without choices', async () => {
    await expect(
      service.create('store_1', {
        name: 'Size',
        isPublished: true,
        isRequired: true,
        choices: [],
      }),
    ).rejects.toThrow('REQUIRED_MENU_OPTION_NEEDS_CHOICES');

    expect(repository.save).not.toHaveBeenCalled();
  });

  it('lists only groups owned by the authenticated vendor', async () => {
    repository.find.mockResolvedValue([]);

    await service.list('store_1');

    expect(repository.find).toHaveBeenCalledWith({
      where: { storeId: 'store_1', userId: 'vendor_1' },
      order: { name: 'ASC' },
    });
  });

  it('deletes using both group id and authenticated vendor id', async () => {
    transactionalRepository.findOne.mockResolvedValue({
      id: 'mog_1',
      userId: 'vendor_1',
      storeId: 'store_1',
    });

    await service.remove('mog_1');

    expect(transactionalRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'mog_1', userId: 'vendor_1' },
    });
    expect(where).toHaveBeenCalledWith('"storeId" = :storeId', {
      storeId: 'store_1',
    });
    expect(transactionalRepository.delete).toHaveBeenCalledWith('mog_1');
  });
});

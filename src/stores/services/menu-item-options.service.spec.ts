import { MenuItem } from '../model/menu-item.entity';
import { MenuItemService } from './menu-item.service';

describe('MenuItemService option selections', () => {
  const optionGroupRepository = {
    find: jest.fn(),
  };
  const service = new MenuItemService(
    {} as never,
    {} as never,
    optionGroupRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const menuItem = {
    id: 'menu_1',
    storeId: 'store_1',
    optionGroupIds: ['size', 'extras'],
  } as MenuItem;

  beforeEach(() => {
    jest.clearAllMocks();
    optionGroupRepository.find.mockResolvedValue([
      {
        id: 'size',
        storeId: 'store_1',
        name: 'Choose a size',
        isPublished: true,
        isRequired: true,
        allowMultiple: false,
        choices: [
          { id: 'regular', name: 'Regular', priceAdjustment: 0 },
          { id: 'large', name: 'Large', priceAdjustment: 500 },
        ],
      },
      {
        id: 'extras',
        storeId: 'store_1',
        name: 'Add extras',
        isPublished: true,
        isRequired: false,
        allowMultiple: true,
        choices: [
          { id: 'egg', name: 'Egg', priceAdjustment: 200 },
          { id: 'plantain', name: 'Plantain', priceAdjustment: 300 },
        ],
      },
    ]);
  });

  it('requires selections for required groups', async () => {
    await expect(service.resolveSelectedOptions(menuItem, [])).rejects.toThrow(
      'REQUIRED_MENU_OPTION_MISSING',
    );
  });

  it('resolves a price and immutable display snapshot from valid choices', async () => {
    const result = await service.resolveSelectedOptions(menuItem, [
      { groupId: 'size', choiceIds: ['large'] },
      { groupId: 'extras', choiceIds: ['plantain', 'egg'] },
    ]);

    expect(result.optionPrice).toBe(1000);
    expect(result.selectedOptions).toEqual([
      {
        groupId: 'size',
        groupName: 'Choose a size',
        choices: [{ id: 'large', name: 'Large', priceAdjustment: 500 }],
      },
      {
        groupId: 'extras',
        groupName: 'Add extras',
        choices: [
          { id: 'plantain', name: 'Plantain', priceAdjustment: 300 },
          { id: 'egg', name: 'Egg', priceAdjustment: 200 },
        ],
      },
    ]);
    expect(result.configurationKey).toBe('extras:egg,plantain|size:large');
  });

  it('rejects multiple selections for a choose-one group', async () => {
    await expect(
      service.resolveSelectedOptions(menuItem, [
        { groupId: 'size', choiceIds: ['regular', 'large'] },
      ]),
    ).rejects.toThrow('TOO_MANY_MENU_OPTIONS_SELECTED');
  });

  it('rejects groups or choices that are not available on the item', async () => {
    await expect(
      service.resolveSelectedOptions(menuItem, [
        { groupId: 'not-attached', choiceIds: ['anything'] },
      ]),
    ).rejects.toThrow('INVALID_MENU_OPTION_SELECTION');

    await expect(
      service.resolveSelectedOptions(menuItem, [
        { groupId: 'size', choiceIds: ['not-a-choice'] },
      ]),
    ).rejects.toThrow('INVALID_MENU_OPTION_SELECTION');
  });

  it('loads option groups for multiple items in one query and preserves item order', async () => {
    const result = await service.getPublishedOptionGroupsForItems([
      menuItem,
      {
        id: 'menu_2',
        storeId: 'store_2',
        optionGroupIds: ['size'],
      } as MenuItem,
    ]);

    expect(optionGroupRepository.find).toHaveBeenCalledTimes(1);
    expect(result.menu_1.map((group) => group.id)).toEqual(['size', 'extras']);
    expect(result.menu_2).toEqual([]);
  });

  it('uses already-loaded option groups when validating a selection', async () => {
    const groups = await service.getPublishedOptionGroups(menuItem);
    optionGroupRepository.find.mockClear();

    await service.resolveSelectedOptions(
      menuItem,
      [{ groupId: 'size', choiceIds: ['regular'] }],
      groups,
    );

    expect(optionGroupRepository.find).not.toHaveBeenCalled();
  });
});

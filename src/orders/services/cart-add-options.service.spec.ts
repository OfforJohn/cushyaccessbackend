import { CartService } from './cart.service';
import { Cart } from '../model/cart.entity';
import { CartItem } from '../model/cart-items.entity';
import { MenuItem } from '../../stores/model/menu-item.entity';

describe('CartService atomic configured-item add', () => {
  const menuItem = {
    id: 'mit_1',
    storeId: 'store_1',
    name: 'Rice',
    images: [],
  } as MenuItem;
  const existingItem = {
    id: 'ctm_1',
    menuItemId: 'mit_1',
    storeId: 'store_1',
    name: 'Rice',
    price: 1500,
    quantity: 2,
    selectedOptions: [],
    optionPrice: 500,
    configurationKey: 'mog_1:moc_1',
  } as CartItem;
  const cart = {
    id: 'cart_1',
    userId: 'user_1',
    storeId: 'store_1',
    cartItems: [existingItem],
    appliedCouponCode: null,
  } as Cart;

  const cartRepository = {
    findOne: jest.fn(),
    save: jest.fn((value) => Promise.resolve(value)),
    create: jest.fn((value) => value),
  };
  const cartItemRepository = {
    save: jest.fn((value) => Promise.resolve(value)),
    create: jest.fn((value) => value),
  };
  const menuItemRepository = {
    findBy: jest.fn().mockResolvedValue([menuItem]),
  };
  const manager = {
    query: jest.fn().mockResolvedValue(undefined),
    getRepository: jest.fn((entity) => {
      if (entity === Cart) return cartRepository;
      if (entity === CartItem) return cartItemRepository;
      return menuItemRepository;
    }),
    transaction: jest.fn((work) => work(manager)),
  };
  const rootCartRepository = { manager };
  const menuItemService = {
    getFinalMenuPrice: jest.fn().mockReturnValue(1000),
    getPublishedOptionGroupsForItems: jest.fn().mockResolvedValue({}),
    resolveSelectedOptions: jest.fn(),
  };
  const service = new CartService(
    rootCartRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    menuItemService as never,
    {} as never,
    {} as never,
  );
  const resolvedOptions = {
    selectedOptions: [],
    optionPrice: 500,
    configurationKey: 'mog_1:moc_1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    existingItem.quantity = 2;
    cart.cartItems = [existingItem];
    cartRepository.findOne.mockResolvedValue(cart);
    cartRepository.save.mockImplementation((value) => Promise.resolve(value));
    cartItemRepository.save.mockImplementation((value) =>
      Promise.resolve(value),
    );
    menuItemRepository.findBy.mockResolvedValue([menuItem]);
    menuItemService.getFinalMenuPrice.mockReturnValue(1000);
    menuItemService.getPublishedOptionGroupsForItems.mockResolvedValue({});
  });

  it('locks the user cart and merges only the matching option variant', async () => {
    const result = await service.addMenuItemAtomically({
      userId: 'user_1',
      userLocationId: 'location_1',
      itemData: { menuItemId: 'mit_1', quantity: 3 },
      menuItem,
      store: { id: 'store_1', addressId: 'address_1' } as never,
      finalPrice: 1000,
      resolvedOptions,
    });

    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['cart:user_1'],
    );
    expect(existingItem.quantity).toBe(5);
    expect(result.totalAmount).toBe(7500);
    expect(cartItemRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a merged variant quantity above the cart limit', async () => {
    existingItem.quantity = 100;

    await expect(
      service.addMenuItemAtomically({
        userId: 'user_1',
        userLocationId: 'location_1',
        itemData: { menuItemId: 'mit_1', quantity: 1 },
        menuItem,
        store: { id: 'store_1', addressId: 'address_1' } as never,
        finalPrice: 1000,
        resolvedOptions,
      }),
    ).rejects.toThrow('INVALID_CART_QUANTITY');

    expect(cartItemRepository.save).not.toHaveBeenCalled();
  });

  it('revalidates every configured cart item with one option-group query', async () => {
    const secondMenuItem = {
      id: 'mit_2',
      storeId: 'store_1',
      name: 'Chicken',
      price: 2000,
    } as MenuItem;
    const firstGroups = [{ id: 'mog_1', storeId: 'store_1' }];
    const secondGroups = [{ id: 'mog_2', storeId: 'store_1' }];
    const cartToRevalidate = {
      id: 'cart_2',
      userId: 'user_1',
      storeId: 'store_1',
      appliedCouponCode: null,
      cartItems: [
        {
          menuItemId: 'mit_1',
          quantity: 1,
          selectedOptions: [
            {
              groupId: 'mog_1',
              choices: [{ id: 'moc_1', name: 'Large', priceAdjustment: 500 }],
            },
          ],
        },
        {
          menuItemId: 'mit_2',
          quantity: 1,
          selectedOptions: [],
        },
      ],
    } as Cart;
    menuItemRepository.findBy.mockResolvedValue([menuItem, secondMenuItem]);
    menuItemService.getPublishedOptionGroupsForItems.mockResolvedValue({
      mit_1: firstGroups,
      mit_2: secondGroups,
    });
    menuItemService.resolveSelectedOptions
      .mockResolvedValueOnce({
        selectedOptions: cartToRevalidate.cartItems[0].selectedOptions,
        optionPrice: 500,
        configurationKey: 'mog_1:moc_1',
      })
      .mockResolvedValueOnce({
        selectedOptions: [],
        optionPrice: 0,
        configurationKey: '',
      });
    menuItemService.getFinalMenuPrice.mockImplementation((item) =>
      item.id === 'mit_1' ? 1000 : 2000,
    );

    const result = await service.calculateCartAmounts(
      cartToRevalidate,
      manager as never,
      true,
    );

    expect(
      menuItemService.getPublishedOptionGroupsForItems,
    ).toHaveBeenCalledTimes(1);
    expect(menuItemService.resolveSelectedOptions).toHaveBeenNthCalledWith(
      1,
      menuItem,
      [{ groupId: 'mog_1', choiceIds: ['moc_1'] }],
      firstGroups,
    );
    expect(menuItemService.resolveSelectedOptions).toHaveBeenNthCalledWith(
      2,
      secondMenuItem,
      [],
      secondGroups,
    );
    expect(result.totalAmount).toBe(3500);
  });
});

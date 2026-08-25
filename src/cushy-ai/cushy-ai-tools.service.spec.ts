import { BadRequestException } from '@nestjs/common';
import { CushyAiToolsService } from './cushy-ai-tools.service';

describe('CushyAiToolsService safety boundaries', () => {
  const menuItemService = {
    findMenuItemAttachStore: jest.fn(),
    getFinalMenuPrice: jest.fn(),
    getPublishedOptionGroups: jest.fn(),
    getPublishedOptionGroupsForItems: jest.fn(),
    resolveSelectedOptions: jest.fn(),
    searchDiscoveryTermsWithScopeForUser: jest.fn(),
  };
  const storeService = {
    getCustomerDiscoveryStoreIdsForUser: jest.fn(),
    getCustomerDiscoveryStoresForUser: jest.fn(),
    getCustomerSelectedLocationForUser: jest.fn(),
    assertStoreCanAcceptOrders: jest.fn(),
  };
  const walletService = {
    getWallet: jest.fn(),
    getOrCreateWallet: jest.fn(),
  };
  const cartService = {
    getCartDetails: jest.fn(),
    getCart: jest.fn(),
  };
  const ordersService = { findByIdForUser: jest.fn() };
  const knowledgeService = { search: jest.fn() };
  const calculateDeliveryUseCase = { execute: jest.fn() };
  const getVirtualAccountUseCase = { execute: jest.fn() };
  const ordersRepository = { find: jest.fn(), findOne: jest.fn() };
  const service = new CushyAiToolsService(
    menuItemService as any,
    storeService as any,
    walletService as any,
    cartService as any,
    ordersService as any,
    knowledgeService as any,
    calculateDeliveryUseCase as any,
    getVirtualAccountUseCase as any,
    ordersRepository as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    menuItemService.getPublishedOptionGroups.mockResolvedValue([]);
    menuItemService.getPublishedOptionGroupsForItems.mockResolvedValue({});
    menuItemService.resolveSelectedOptions.mockResolvedValue({
      selectedOptions: [],
      optionPrice: 0,
      configurationKey: '',
    });
  });

  it('requires discovery calls to declare the customer-requested location context', () => {
    expect(service.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'search_catalog',
          inputSchema: expect.objectContaining({
            required: expect.arrayContaining(['query', 'requestedLocation']),
            properties: expect.objectContaining({
              alternativeQueries: expect.objectContaining({
                type: 'array',
                maxItems: 3,
              }),
            }),
          }),
        }),
        expect.objectContaining({
          name: 'list_nearby_merchants',
          inputSchema: expect.objectContaining({
            required: expect.arrayContaining(['requestedLocation']),
          }),
        }),
      ]),
    );
  });

  it('returns only the public saved delivery location as model context', async () => {
    storeService.getCustomerSelectedLocationForUser.mockResolvedValue({
      city: 'Minna',
      state: 'Niger',
      country: 'Nigeria',
      address: 'Private house address',
      latitude: 9.6,
      longitude: 6.5,
    });

    await expect(service.getDeliveryContext('customer_1')).resolves.toEqual({
      modelContent: {
        locationRequired: false,
        selectedLocation: {
          city: 'Minna',
          state: 'Niger',
          country: 'Nigeria',
        },
      },
    });
  });

  it('never exposes an unscoped merchant list when location is missing', async () => {
    storeService.getCustomerDiscoveryStoresForUser.mockResolvedValue({
      locationRequired: true,
      selectedLocation: null,
      stores: [],
    });

    const result = await service.execute(
      'list_nearby_merchants',
      {},
      'customer_1',
    );

    expect(result.modelContent).toEqual(
      expect.objectContaining({ locationRequired: true, count: 0 }),
    );
    expect(result.components).toEqual([
      expect.objectContaining({ id: 'location:required' }),
    ]);
  });

  it('suppresses merchants outside an explicitly requested location', async () => {
    storeService.getCustomerDiscoveryStoresForUser.mockResolvedValue({
      locationRequired: false,
      selectedLocation: {
        city: 'Minna',
        state: 'Niger',
        country: 'Nigeria',
        address: 'Bosso Road, Minna',
      },
      stores: [
        {
          id: 'minna_store',
          name: 'Minna Kitchen',
          category: 'restaurant',
          availabilityLabel: 'Open',
          location: 'Shiroro Road, Minna, Niger State, Nigeria',
          isOpen: true,
          isOrderable: true,
        },
      ],
    });

    const result = await service.execute(
      'list_nearby_merchants',
      { category: 'restaurant', requestedLocation: 'Plateau, Jos, Nigeria' },
      'customer_1',
    );

    expect(result.modelContent).toEqual(
      expect.objectContaining({
        requestedLocation: 'Plateau, Jos, Nigeria',
        locationMismatch: true,
        count: 0,
        merchants: [],
      }),
    );
    expect(result.components).toEqual([
      expect.objectContaining({
        id: 'location:required',
        subtitle: expect.stringContaining('Plateau, Jos, Nigeria'),
        actions: [expect.objectContaining({ type: 'OPEN_LOCATION' })],
      }),
    ]);
  });

  it('keeps merchants that match the explicitly requested location', async () => {
    storeService.getCustomerDiscoveryStoresForUser.mockResolvedValue({
      locationRequired: false,
      selectedLocation: {
        city: 'Jos',
        state: 'Plateau',
        country: 'Nigeria',
        address: 'Rayfield Road, Jos',
      },
      stores: [
        {
          id: 'jos_store',
          name: 'Jos Kitchen',
          category: 'restaurant',
          availabilityLabel: 'Open',
          location: 'Rayfield Road, Jos, Plateau State, Nigeria',
          isOpen: true,
          isOrderable: true,
        },
      ],
    });

    const result = await service.execute(
      'list_nearby_merchants',
      { category: 'restaurant', requestedLocation: 'Jos' },
      'customer_1',
    );

    expect(result.modelContent).toEqual(
      expect.objectContaining({ locationMismatch: false, count: 1 }),
    );
    expect(result.components).toEqual([
      expect.objectContaining({ id: 'merchant:jos_store' }),
    ]);
  });

  it('does not confuse two cities merely because they share a state', async () => {
    storeService.getCustomerDiscoveryStoresForUser.mockResolvedValue({
      locationRequired: false,
      selectedLocation: {
        city: 'Minna',
        state: 'Niger',
        country: 'Nigeria',
        address: 'Bosso Road, Minna',
      },
      stores: [
        {
          id: 'minna_store',
          name: 'Minna Kitchen',
          category: 'restaurant',
          availabilityLabel: 'Open',
          location: 'Minna, Niger State',
        },
      ],
    });

    const result = await service.execute(
      'list_nearby_merchants',
      { requestedLocation: 'Suleja, Niger State' },
      'customer_1',
    );

    expect(result.modelContent).toEqual(
      expect.objectContaining({ locationMismatch: true, merchants: [] }),
    );
    expect(result.components).toEqual([
      expect.objectContaining({ id: 'location:required' }),
    ]);
  });

  it('returns an actionable merchant card for a merchant-name-only match', async () => {
    menuItemService.searchDiscoveryTermsWithScopeForUser.mockResolvedValue({
      selectedLocation: {
        city: 'Minna',
        state: 'Niger',
        country: 'Nigeria',
        address: 'Bosso Road, Minna',
      },
      response: {
        toJSON: () => ({
          message: 'SEARCH_RESULTS_FETCHED_SUCCESSFULLY',
          data: [
            {
              store: {
                id: 'store_1',
                name: 'Bilkebab',
                category: 'RESTAURANT',
                location: 'Minna',
                isOpen: true,
                isOrderable: true,
                availabilityLabel: 'Open',
              },
              matchedItems: [],
            },
          ],
        }),
      },
    });

    const result = await service.execute(
      'search_catalog',
      { query: 'Bilkebab' },
      'customer_1',
    );

    expect(result.components).toEqual([
      expect.objectContaining({
        id: 'merchant:store_1',
        actions: [expect.objectContaining({ type: 'OPEN_MERCHANT' })],
      }),
    ]);
    expect(result.modelContent.merchants).toEqual([
      expect.objectContaining({ name: 'Bilkebab', location: 'Minna' }),
    ]);
  });

  it('suppresses catalog cards outside an explicitly requested location', async () => {
    menuItemService.searchDiscoveryTermsWithScopeForUser.mockResolvedValue({
      selectedLocation: {
        city: 'Minna',
        state: 'Niger',
        country: 'Nigeria',
        address: 'Bosso, Minna',
      },
      response: {
        toJSON: () => ({
          message: 'SEARCH_RESULTS_FETCHED_SUCCESSFULLY',
          data: [
            {
              store: {
                id: 'minna_store',
                name: 'Minna Kitchen',
                category: 'restaurant',
                location: 'Bosso, Minna, Niger State, Nigeria',
                isOpen: true,
                isOrderable: true,
              },
              matchedItems: [
                {
                  id: 'rice_1',
                  name: 'Jollof rice',
                  storeId: 'minna_store',
                },
              ],
            },
          ],
        }),
      },
    });

    const result = await service.execute(
      'search_catalog',
      { query: 'jollof rice', requestedLocation: 'Jos' },
      'customer_1',
    );

    expect(result.modelContent).toEqual(
      expect.objectContaining({
        requestedLocation: 'Jos',
        locationMismatch: true,
        count: 0,
        items: [],
        merchants: [],
      }),
    );
    expect(result.components).toEqual([
      expect.objectContaining({ id: 'location:required' }),
    ]);
  });

  it('detects a requested-location mismatch even when the scoped search has no results', async () => {
    menuItemService.searchDiscoveryTermsWithScopeForUser.mockResolvedValue({
      selectedLocation: {
        city: 'Minna',
        state: 'Niger',
        country: 'Nigeria',
        address: 'Bosso Road, Minna',
      },
      response: {
        toJSON: () => ({
          message: 'SEARCH_RESULTS_FETCHED_SUCCESSFULLY',
          data: [],
        }),
      },
    });

    const result = await service.execute(
      'search_catalog',
      { query: 'pizza', requestedLocation: 'Jos' },
      'customer_1',
    );

    expect(result.modelContent).toEqual(
      expect.objectContaining({ locationMismatch: true, count: 0 }),
    );
    expect(result.components).toEqual([
      expect.objectContaining({ id: 'location:required' }),
    ]);
  });

  it('excludes incidental description matches when exact product names exist', async () => {
    menuItemService.searchDiscoveryTermsWithScopeForUser.mockResolvedValue({
      selectedLocation: null,
      response: {
        toJSON: () => ({
          message: 'SEARCH_RESULTS_FETCHED_SUCCESSFULLY',
          data: [
            {
              store: { id: 'store_1', name: 'Food Hub', isOrderable: true },
              matchedItems: [
                { id: 'jollof', name: 'Jollof rice', storeId: 'store_1' },
                {
                  id: 'semo',
                  name: 'Semovita and efo riro',
                  description: 'Served with rice options',
                  storeId: 'store_1',
                },
              ],
            },
          ],
        }),
      },
    });

    const result = await service.execute(
      'search_catalog',
      { query: 'jollof rice' },
      'customer_1',
    );

    expect(result.components?.map((component) => component.title)).toEqual([
      'Jollof rice',
    ]);
    expect(result.modelContent.merchants).toEqual([
      expect.objectContaining({ name: 'Food Hub' }),
    ]);
  });

  it('searches complementary food terms together and returns grounded diverse items', async () => {
    menuItemService.searchDiscoveryTermsWithScopeForUser.mockResolvedValue({
      selectedLocation: { city: 'Minna', state: 'Niger' },
      response: {
        toJSON: () => ({
          message: 'SEARCH_RESULTS_FETCHED_SUCCESSFULLY',
          data: [
            {
              store: {
                id: 'store_1',
                name: 'Food Hub',
                isOrderable: true,
                location: 'Minna',
              },
              matchedItems: [
                {
                  id: 'chicken',
                  name: 'Grilled chicken',
                  description: 'Chicken grilled with peppers and onions.',
                  storeId: 'store_1',
                  price: 2500,
                },
                {
                  id: 'fish',
                  name: 'Grilled fish',
                  description: 'Whole fish grilled to order.',
                  storeId: 'store_1',
                  price: 3200,
                },
                {
                  id: 'salad',
                  name: 'Garden salad',
                  description: 'Lettuce, cucumber and tomato.',
                  storeId: 'store_1',
                  price: 1800,
                },
              ],
            },
          ],
        }),
      },
    });

    const result = await service.execute(
      'search_catalog',
      {
        query: 'grilled chicken',
        alternativeQueries: [
          'grilled fish',
          'salad',
          'grilled chicken',
          'ignored fifth term',
        ],
        requestedLocation: '',
        category: 'restaurant',
      },
      'customer_1',
    );

    expect(
      menuItemService.searchDiscoveryTermsWithScopeForUser,
    ).toHaveBeenCalledWith(
      ['grilled chicken', 'grilled fish', 'salad', 'ignored fifth term'],
      'customer_1',
      'restaurant',
    );
    expect(result.components?.map((component) => component.title)).toEqual([
      'Grilled chicken',
      'Grilled fish',
      'Garden salad',
    ]);
    expect(result.components?.[0].data).toEqual(
      expect.objectContaining({
        description: 'Chicken grilled with peppers and onions.',
      }),
    );
    expect(result.modelContent.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Grilled chicken',
          description: 'Chicken grilled with peppers and onions.',
        }),
      ]),
    );
  });

  it('adds compact option context in one batch and routes configurable items to the picker', async () => {
    menuItemService.searchDiscoveryTermsWithScopeForUser.mockResolvedValue({
      selectedLocation: { city: 'Minna', state: 'Niger' },
      response: {
        toJSON: () => ({
          data: [
            {
              store: {
                id: 'store_1',
                name: 'Ice Cream Shop',
                isOrderable: true,
                location: 'Minna',
              },
              matchedItems: [
                {
                  id: 'sundae_1',
                  name: 'Vanilla sundae',
                  storeId: 'store_1',
                  price: 2000,
                  optionGroupIds: ['size'],
                },
              ],
            },
          ],
        }),
      },
    });
    menuItemService.getPublishedOptionGroupsForItems.mockResolvedValue({
      sundae_1: [
        {
          id: 'size',
          name: 'Size',
          isRequired: true,
          allowMultiple: false,
          choices: [
            { id: 'small', name: 'Small', priceAdjustment: 0 },
            { id: 'large', name: 'Large', priceAdjustment: 700 },
          ],
        },
      ],
    });

    const result = await service.execute(
      'search_catalog',
      { query: 'vanilla sundae', requestedLocation: '' },
      'customer_1',
    );

    expect(
      menuItemService.getPublishedOptionGroupsForItems,
    ).toHaveBeenCalledTimes(1);
    expect(result.modelContent.items[0].optionGroups).toEqual([
      {
        groupId: 'size',
        name: 'Size',
        required: true,
        allowMultiple: false,
        choices: [
          { choiceId: 'small', name: 'Small', priceAdjustment: 0 },
          { choiceId: 'large', name: 'Large', priceAdjustment: 700 },
        ],
      },
    ]);
    expect(result.components?.[0].actions).toEqual([
      expect.objectContaining({
        type: 'OPEN_PRODUCT',
        label: 'Choose options',
      }),
    ]);
  });

  it('honours a merchant named in natural search text even if the model omits merchantName', async () => {
    menuItemService.searchDiscoveryTermsWithScopeForUser.mockResolvedValue({
      selectedLocation: null,
      response: {
        toJSON: () => ({
          message: 'SEARCH_RESULTS_FETCHED_SUCCESSFULLY',
          data: [
            {
              store: { id: 'bil', name: 'Bilkebab', isOrderable: true },
              matchedItems: [
                { id: 'bil-rice', name: 'Jollof rice', storeId: 'bil' },
              ],
            },
            {
              store: { id: 'other', name: 'Other Kitchen', isOrderable: true },
              matchedItems: [
                { id: 'other-rice', name: 'Jollof rice', storeId: 'other' },
              ],
            },
          ],
        }),
      },
    });

    const result = await service.execute(
      'search_catalog',
      { query: 'help me order jollof rice from Bilkebab' },
      'customer_1',
    );

    expect(result.components?.map((component) => component.id)).toEqual([
      'product:bil-rice',
    ]);
    expect(result.modelContent.merchants).toEqual([
      expect.objectContaining({ name: 'Bilkebab' }),
    ]);
  });

  it('does not turn a description-only match into an unrelated product card', async () => {
    menuItemService.searchDiscoveryTermsWithScopeForUser.mockResolvedValue({
      selectedLocation: null,
      response: {
        toJSON: () => ({
          message: 'SEARCH_RESULTS_FETCHED_SUCCESSFULLY',
          data: [
            {
              store: { id: 'store_1', name: 'Food Hub', isOrderable: true },
              matchedItems: [
                {
                  id: 'semo',
                  name: 'Semovita and efo riro',
                  description: 'Our kitchen also serves jollof rice',
                  storeId: 'store_1',
                },
              ],
            },
          ],
        }),
      },
    });

    const result = await service.execute(
      'search_catalog',
      { query: 'jollof rice' },
      'customer_1',
    );

    expect(result.components).toEqual([]);
    expect(result.modelContent.items).toEqual([]);
    expect(result.modelContent.merchants).toEqual([]);
  });

  it('requires a selected location before preparing a catalog action', async () => {
    menuItemService.findMenuItemAttachStore.mockResolvedValue({
      id: 'menu_1',
      storeId: 'store_1',
      isAvailable: true,
      store: { name: 'Store' },
    });
    storeService.getCustomerDiscoveryStoreIdsForUser.mockResolvedValue(null);

    await expect(
      service.execute(
        'prepare_add_to_cart',
        { menuItemId: 'menu_1' },
        'customer_1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates explicit option choices and prices the prepared cart action', async () => {
    const item = {
      id: 'menu_1',
      storeId: 'store_1',
      isAvailable: true,
      optionGroupIds: ['size'],
      store: { name: 'Ice Cream Shop' },
      images: [],
    };
    const groups = [
      {
        id: 'size',
        name: 'Size',
        isRequired: true,
        allowMultiple: false,
        choices: [{ id: 'large', name: 'Large', priceAdjustment: 700 }],
      },
    ];
    menuItemService.findMenuItemAttachStore.mockResolvedValue(item);
    storeService.getCustomerDiscoveryStoreIdsForUser.mockResolvedValue([
      'store_1',
    ]);
    storeService.assertStoreCanAcceptOrders.mockResolvedValue(item.store);
    menuItemService.getPublishedOptionGroups.mockResolvedValue(groups);
    menuItemService.getFinalMenuPrice.mockReturnValue(2000);
    menuItemService.resolveSelectedOptions.mockResolvedValue({
      selectedOptions: [
        {
          groupId: 'size',
          groupName: 'Size',
          choices: [{ id: 'large', name: 'Large', priceAdjustment: 700 }],
        },
      ],
      optionPrice: 700,
      configurationKey: 'size:large',
    });

    const result = await service.execute(
      'prepare_add_to_cart',
      {
        menuItemId: 'menu_1',
        quantity: 2,
        selectedOptions: [{ groupId: 'size', choiceIds: ['large'] }],
      },
      'customer_1',
    );

    expect(menuItemService.resolveSelectedOptions).toHaveBeenCalledWith(
      item,
      [{ groupId: 'size', choiceIds: ['large'] }],
      groups,
    );
    expect(result.modelContent).toEqual(
      expect.objectContaining({ unitPrice: 2700 }),
    );
    expect(result.components?.[0].actions).toEqual([
      expect.objectContaining({
        type: 'ADD_TO_CART',
        payload: expect.objectContaining({
          storeId: 'store_1',
          selectedOptions: [{ groupId: 'size', choiceIds: ['large'] }],
        }),
      }),
    ]);
  });

  it('opens the product picker instead of failing when a required option is unresolved', async () => {
    const item = {
      id: 'menu_1',
      storeId: 'store_1',
      isAvailable: true,
      store: { name: 'Ice Cream Shop' },
      images: [],
    };
    menuItemService.findMenuItemAttachStore.mockResolvedValue(item);
    storeService.getCustomerDiscoveryStoreIdsForUser.mockResolvedValue([
      'store_1',
    ]);
    menuItemService.getPublishedOptionGroups.mockResolvedValue([
      {
        id: 'size',
        name: 'Size',
        isRequired: true,
        choices: [{ id: 'small', name: 'Small', priceAdjustment: 0 }],
      },
    ]);
    menuItemService.getFinalMenuPrice.mockReturnValue(2000);

    const result = await service.execute(
      'prepare_add_to_cart',
      { menuItemId: 'menu_1' },
      'customer_1',
    );

    expect(menuItemService.resolveSelectedOptions).not.toHaveBeenCalled();
    expect(result.modelContent).toEqual(
      expect.objectContaining({
        readyToAdd: false,
        reason: 'REQUIRED_MENU_OPTION_MISSING',
      }),
    );
    expect(result.components?.[0].actions).toEqual([
      expect.objectContaining({
        type: 'OPEN_PRODUCT',
        label: 'Choose options',
      }),
    ]);
  });

  it('bounds quantities and returns a minimal cart summary', async () => {
    cartService.getCartDetails.mockResolvedValue({
      toJSON: () => ({
        data: {
          id: 'private-cart-id',
          subtotal: 2000,
          store: { name: 'Bilkebab', privateField: 'hidden' },
          deliveryAddress: 'private address',
          cartItems: [
            {
              id: 'cart-item-id',
              quantity: 2.8,
              price: 1000,
              menuItem: { id: 'menu_1', name: 'Rice' },
            },
          ],
        },
      }),
    });

    const result = await service.execute('get_cart', {}, 'customer_1');

    expect(result.modelContent.cart).toEqual({
      distinctItems: 1,
      itemCount: 2,
      subtotal: 2000,
      merchantName: 'Bilkebab',
      items: [
        {
          menuItemId: 'menu_1',
          name: 'Rice',
          quantity: 2,
          unitPrice: 1000,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('private address');
    expect(JSON.stringify(result)).not.toContain('private-cart-id');
  });

  it('returns recent order items for preference-aware recommendations', async () => {
    ordersRepository.find.mockResolvedValue([
      {
        id: 'ord_1',
        status: 'COMPLETED',
        totalAmount: '2500.00',
        createdAt: new Date('2026-08-01T10:00:00Z'),
        store: { name: 'Bilkebab' },
        orderItems: [
          {
            name: 'Jollof rice',
            quantity: 2,
            price: '1000.00',
            selectedOptions: [
              {
                groupName: 'Portion',
                choices: [{ name: 'Large' }],
              },
            ],
          },
        ],
      },
    ]);

    const result = await service.execute('get_recent_orders', {}, 'customer_1');

    expect(ordersRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'customer_1' },
        relations: ['store', 'orderItems'],
        take: 8,
      }),
    );
    expect(result.modelContent.orders).toEqual([
      expect.objectContaining({
        merchantName: 'Bilkebab',
        items: [
          {
            name: 'Jollof rice',
            quantity: 2,
            unitPrice: 1000,
            selectedOptions: [{ groupName: 'Portion', choices: ['Large'] }],
          },
        ],
      }),
    ]);
    expect(result.components?.[0].actions).toEqual([
      expect.objectContaining({ type: 'OPEN_ORDER', label: 'View order' }),
    ]);
    expect(result.components?.[0].data).not.toHaveProperty('items');

    const recommendationContext = await service.execute(
      'get_recent_orders',
      { includeCards: false },
      'customer_1',
    );
    expect(recommendationContext.modelContent.orders).toHaveLength(1);
    expect(recommendationContext.components).toEqual([]);
  });

  it.each([
    ['status', 'OPEN_ORDER', 'View order'],
    ['track', 'OPEN_ORDER_TRACKING', 'Track order'],
  ])(
    'returns only the %s order action requested by the customer',
    async (intent, actionType, label) => {
      ordersService.findByIdForUser.mockResolvedValue({
        toJSON: () => ({
          data: {
            id: 'ord_1',
            status: 'PICKED_UP',
            totalAmount: '2500.00',
            store: { name: 'Bilkebab' },
          },
        }),
      });

      const result = await service.execute(
        'get_order_status',
        { orderId: 'ord_1', intent },
        'customer_1',
      );

      expect(result.components?.[0].actions).toEqual([
        {
          type: actionType,
          label,
          payload: { orderId: 'ord_1', status: 'PICKED_UP' },
        },
      ]);
    },
  );

  it('prepares a checkout review with server-calculated fees and wallet balance', async () => {
    cartService.getCart.mockResolvedValue({
      id: 'cart_1',
      storeId: 'store_1',
      pickUpLocationId: 'pickup_1',
      dropOffLocationId: 'dropoff_1',
      totalAmount: 2500,
      subtotalBeforeDiscount: 2500,
      cartItems: [{ name: 'Jollof rice', quantity: 1, price: 2500 }],
    });
    storeService.assertStoreCanAcceptOrders.mockResolvedValue({
      id: 'store_1',
      addressId: 'pickup_current',
    });
    calculateDeliveryUseCase.execute.mockResolvedValue({
      toJSON: () => ({ data: { totalCharges: 500 } }),
    });
    walletService.getWallet.mockResolvedValue({
      id: 'wallet_1',
      walletBalance: 5000,
    });

    const result = await service.execute(
      'prepare_checkout',
      { fullHouseAddress: '12 Bosso Road, Minna' },
      'customer_1',
    );

    expect(cartService.getCart).toHaveBeenCalledWith('customer_1');
    expect(calculateDeliveryUseCase.execute).toHaveBeenCalledWith(
      'pickup_current',
      'dropoff_1',
      expect.any(String),
      expect.any(String),
    );

    expect(result.modelContent).toEqual(
      expect.objectContaining({
        ready: true,
        subtotal: 2500,
        platformFee: 100,
        deliveryAndServiceFees: 500,
        total: 3100,
      }),
    );
    expect(result.components).toEqual([
      expect.objectContaining({
        type: 'checkout_card',
        actions: [expect.objectContaining({ type: 'CONFIRM_ORDER' })],
      }),
    ]);
  });

  it('returns exact top-up details without exposing a confirm action when funds are insufficient', async () => {
    cartService.getCart.mockResolvedValue({
      id: 'cart_1',
      storeId: 'store_1',
      pickUpLocationId: 'pickup_1',
      dropOffLocationId: 'dropoff_1',
      totalAmount: 2500,
      subtotalBeforeDiscount: 2500,
      cartItems: [{ name: 'Jollof rice', quantity: 1, price: 2500 }],
    });
    storeService.assertStoreCanAcceptOrders.mockResolvedValue({
      id: 'store_1',
    });
    calculateDeliveryUseCase.execute.mockResolvedValue({
      toJSON: () => ({ data: { totalCharges: 500 } }),
    });
    walletService.getWallet.mockResolvedValue({
      id: 'wallet_1',
      walletBalance: 1000,
    });
    getVirtualAccountUseCase.execute.mockResolvedValue({
      toJSON: () => ({
        data: {
          bank: 'Wema Bank',
          accountNumber: '1234567890',
          accountName: 'Cushy Access - Customer',
        },
      }),
    });

    const result = await service.execute(
      'prepare_checkout',
      { fullHouseAddress: '12 Bosso Road, Minna' },
      'customer_1',
    );

    expect(result.modelContent).toEqual(
      expect.objectContaining({
        ready: false,
        reason: 'INSUFFICIENT_FUND',
        walletBalance: 1000,
        shortfall: 2100,
      }),
    );
    expect(result.components).toEqual([
      expect.objectContaining({
        type: 'funding_card',
        actions: expect.arrayContaining([
          expect.objectContaining({ type: 'REFRESH_CHECKOUT' }),
          expect.objectContaining({ type: 'OPEN_WALLET' }),
        ]),
      }),
    ]);
    expect(JSON.stringify(result.components)).not.toContain('CONFIRM_ORDER');
  });
});

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MenuItemService } from '../stores/services/menu-item.service';
import { StoreService } from '../stores/services/stores.service';
import { WalletService } from '../wallet/services/wallet.service';
import { CartService } from '../orders/services/cart.service';
import { OrdersService } from '../orders/services/orders.service';
import { Orders } from '../orders/model/order.entity';
import { OrderStatus } from '../orders/model/enum/order-status.enum';
import { AiComponent, AiToolDefinition, AiToolResult } from './model/ai.types';
import { StoreCategory } from '../stores/model/enums/store.category';
import { CushyAiKnowledgeService } from './cushy-ai-knowledge.service';
import { CalculateDeliveryUseCase } from '../orders/usecases/calculate-delivery-charges.usecase';
import { GetVirtualAccountUseCase } from '../wallet/usecases/get-virtual-account.usecase';
import { VehicleType } from '../orders/model/enum/vechicle-type.enum';
import { OrderTypes } from '../orders/model/enum/order-types.enum';

const MAX_TOOL_RESULTS = 8;
const MAX_DISCOVERY_CARDS = 4;
const MAX_DISCOVERY_QUERIES = 4;
const MAX_CATALOG_DESCRIPTION_LENGTH = 360;
const MAX_CONTEXT_OPTION_GROUPS = 4;
const MAX_CONTEXT_OPTION_CHOICES = 8;

@Injectable()
export class CushyAiToolsService {
  readonly definitions: AiToolDefinition[] = [
    {
      name: 'search_company_knowledge',
      description:
        'Search approved Cushy Access company information, policies, service guidance and FAQs. Use before answering company-specific questions.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
    {
      name: 'search_catalog',
      description:
        'Search currently eligible merchants and available menu items in the customer selected delivery city. Use for food, grocery, pharmacy, product and merchant discovery.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Primary concise product or merchant search term, preferably one recognisable catalog keyword or short item name.',
          },
          alternativeQueries: {
            type: 'array',
            maxItems: MAX_DISCOVERY_QUERIES - 1,
            items: { type: 'string' },
            description:
              'Optional complementary catalog terms for recommendations or broad cravings. Use at most three distinct one- or two-food terms; do not put a medical condition here.',
          },
          merchantName: {
            type: 'string',
            description: 'Optional merchant explicitly named by the customer.',
          },
          requestedLocation: {
            type: 'string',
            description:
              'Exact city, state or area explicitly requested by the customer, or an empty string when none was named. Do not substitute the saved delivery location.',
          },
          category: {
            type: 'string',
            enum: Object.values(StoreCategory),
          },
        },
        required: ['query', 'requestedLocation'],
      },
    },
    {
      name: 'list_nearby_merchants',
      description:
        'List eligible merchants in the customer selected delivery city. Use when the customer asks what restaurants, pharmacies, groceries or stores are nearby or available without naming a product.',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: Object.values(StoreCategory),
          },
          requestedLocation: {
            type: 'string',
            description:
              'Exact city, state or area explicitly requested by the customer, or an empty string when none was named. Do not substitute the saved delivery location.',
          },
        },
        required: ['requestedLocation'],
      },
    },
    {
      name: 'get_wallet_balance',
      description:
        'Get the authenticated customer current Cushcoin wallet balance.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_recent_orders',
      description:
        'Get the authenticated customer recent orders and statuses. Set includeCards=false when using history only to personalize recommendations; set it true only when the customer asks to view order history.',
      inputSchema: {
        type: 'object',
        properties: { includeCards: { type: 'boolean' } },
        required: ['includeCards'],
      },
    },
    {
      name: 'get_order_status',
      description:
        'Get an authenticated customer order. Set intent=track only when the customer explicitly wants live tracking, location or the tracking map; use intent=status for status questions and ordinary order updates. Omit orderId to use the most recent active order.',
      inputSchema: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          intent: { type: 'string', enum: ['status', 'track'] },
        },
        required: ['intent'],
      },
    },
    {
      name: 'get_cart',
      description: 'Get the authenticated customer current cart.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'prepare_add_to_cart',
      description:
        'Validate a menu item and present either an Add to cart action or the product option picker when a required choice is unresolved. This does not mutate the cart; the customer confirms by tapping the action.',
      inputSchema: {
        type: 'object',
        properties: {
          menuItemId: { type: 'string' },
          quantity: { type: 'integer', minimum: 1, maximum: 20 },
          selectedOptions: {
            type: 'array',
            maxItems: 20,
            description:
              'Option selections explicitly requested by the customer, using group and choice IDs returned by catalog context. Omit when the item has no options or the customer wants to choose in the app.',
            items: {
              type: 'object',
              properties: {
                groupId: { type: 'string' },
                choiceIds: {
                  type: 'array',
                  maxItems: 30,
                  items: { type: 'string' },
                },
              },
              required: ['groupId', 'choiceIds'],
            },
          },
        },
        required: ['menuItemId'],
      },
    },
    {
      name: 'prepare_checkout',
      description:
        'Prepare the current cart for checkout after the customer supplies a complete house address. Include any optional rider or merchant notes. Calculates current fees, checks Cushcoin, and returns either a one-tap confirmation or funding instructions. Never places the order.',
      inputSchema: {
        type: 'object',
        properties: {
          fullHouseAddress: { type: 'string' },
          noteForRider: { type: 'string' },
          noteForStore: { type: 'string' },
          additionalPhoneNumber: { type: 'string' },
        },
        required: ['fullHouseAddress'],
      },
    },
    {
      name: 'open_support',
      description: 'Present a direct human support handoff action.',
      inputSchema: {
        type: 'object',
        properties: { reason: { type: 'string' } },
      },
    },
    {
      name: 'open_health_consultation',
      description:
        'Present the health professional consultation action for medical concerns, urgent symptoms or when the user requests a clinician.',
      inputSchema: {
        type: 'object',
        properties: { urgent: { type: 'boolean' }, reason: { type: 'string' } },
      },
    },
  ];

  constructor(
    private readonly menuItemService: MenuItemService,
    private readonly storeService: StoreService,
    private readonly walletService: WalletService,
    private readonly cartService: CartService,
    private readonly ordersService: OrdersService,
    private readonly knowledgeService: CushyAiKnowledgeService,
    private readonly calculateDeliveryUseCase: CalculateDeliveryUseCase,
    private readonly getVirtualAccountUseCase: GetVirtualAccountUseCase,
    @InjectRepository(Orders)
    private readonly ordersRepository: Repository<Orders>,
  ) {}

  async getDeliveryContext(userId: string): Promise<AiToolResult> {
    const selectedLocation =
      await this.storeService.getCustomerSelectedLocationForUser(userId);
    return {
      modelContent: {
        locationRequired: !selectedLocation,
        selectedLocation: this.publicLocation(selectedLocation),
      },
    };
  }

  async execute(
    name: string,
    rawInput: Record<string, unknown>,
    userId: string,
  ): Promise<AiToolResult> {
    switch (name) {
      case 'search_company_knowledge':
        return this.searchCompanyKnowledge(rawInput);
      case 'search_catalog':
        return this.searchCatalog(rawInput, userId);
      case 'list_nearby_merchants':
        return this.listNearbyMerchants(rawInput, userId);
      case 'get_wallet_balance':
        return this.getWalletBalance(userId);
      case 'get_recent_orders':
        return this.getRecentOrders(rawInput, userId);
      case 'get_order_status':
        return this.getOrderStatus(rawInput, userId);
      case 'get_cart':
        return this.getCart();
      case 'prepare_add_to_cart':
        return this.prepareAddToCart(rawInput, userId);
      case 'prepare_checkout':
        return this.prepareCheckout(rawInput, userId);
      case 'open_support':
        return this.openSupport(rawInput);
      case 'open_health_consultation':
        return this.openHealthConsultation(rawInput);
      default:
        throw new BadRequestException('UNKNOWN_AI_TOOL');
    }
  }

  private async searchCompanyKnowledge(
    input: Record<string, unknown>,
  ): Promise<AiToolResult> {
    const query = this.requiredString(input.query, 'query', 200);
    const articles = await this.knowledgeService.search(query);
    return {
      modelContent: {
        query,
        found: articles.length > 0,
        articles: articles.map((article) => ({
          title: article.title,
          category: article.category,
          content: article.content.slice(0, 4_000),
          updatedAt: article.updatedAt,
        })),
      },
    };
  }

  private async searchCatalog(
    input: Record<string, unknown>,
    userId: string,
  ): Promise<AiToolResult> {
    const query = this.requiredString(input.query, 'query', 80);
    const alternativeQueries = this.optionalStringArray(
      input.alternativeQueries,
      MAX_DISCOVERY_QUERIES,
      80,
    );
    const queries = [query, ...alternativeQueries]
      .filter(
        (candidate, index, all) =>
          all.findIndex(
            (value) => value.toLowerCase() === candidate.toLowerCase(),
          ) === index,
      )
      .slice(0, MAX_DISCOVERY_QUERIES);
    const categories = Object.values(StoreCategory);
    const category = categories.includes(input.category as StoreCategory)
      ? (input.category as StoreCategory)
      : undefined;
    const scopedSearch =
      await this.menuItemService.searchDiscoveryTermsWithScopeForUser(
        queries,
        userId,
        category,
      );
    const responseJson = scopedSearch.response.toJSON();
    const selectedLocation = scopedSearch.selectedLocation;
    const locationRequired =
      responseJson.message === 'SEARCH_LOCATION_REQUIRED';
    const requestedLocation = this.optionalString(input.requestedLocation, 100);
    const requestedMerchantName = this.optionalString(
      input.merchantName,
      100,
    )?.toLowerCase();
    const unfilteredGroups = (responseJson.data || []) as Array<any>;
    const locationMismatch = Boolean(
      requestedLocation &&
      selectedLocation &&
      !this.locationMatchesRequest(selectedLocation, requestedLocation),
    );
    const allGroups = locationMismatch ? [] : unfilteredGroups;
    const normalizedQueries = queries.map((candidate) =>
      candidate.toLowerCase(),
    );
    const inferredMerchantName = allGroups
      .map((group) =>
        String(group.store?.name || '')
          .trim()
          .toLowerCase(),
      )
      .filter(
        (name) =>
          name.length >= 4 &&
          normalizedQueries.some((candidate) => candidate.includes(name)),
      )
      .sort((left, right) => right.length - left.length)[0];
    const merchantName = requestedMerchantName || inferredMerchantName;
    const groups = allGroups.filter(
      (group) =>
        !merchantName ||
        String(group.store?.name || '')
          .toLowerCase()
          .includes(merchantName),
    );
    const rawMatches = groups.flatMap((group) =>
      (group.matchedItems || []).map((item) => ({
        ...item,
        store: group.store,
      })),
    );
    // Description-only matches are often incidental (for example semovita
    // whose description mentions rice). Never render them as a product the
    // customer asked for; the assistant can offer alternatives separately.
    const matches = this.selectDiverseCatalogMatches(
      rawMatches,
      queries,
      MAX_DISCOVERY_CARDS,
    );
    const matchesWithOptions = await this.attachPublishedOptions(matches);

    const components: AiComponent[] = matchesWithOptions.map((item) => {
      const hasOptions = item.optionGroups.length > 0;
      return {
        id: `product:${item.id}`,
        type: 'product_card',
        title: item.name,
        subtitle: item.store?.name,
        imageUrl: item.image || undefined,
        data: {
          menuItemId: item.id,
          merchantId: item.storeId,
          merchantName: item.store?.name,
          location: item.store?.location,
          distanceKm: item.store?.distanceKm,
          description:
            this.optionalString(
              item.description,
              MAX_CATALOG_DESCRIPTION_LENGTH,
            ) || undefined,
          price: Number(item.finalPrice ?? item.price),
          currency: 'NGN',
          isOpen: item.store?.isOpen,
          hasOptions,
        },
        actions: [
          {
            type: 'OPEN_PRODUCT',
            label: hasOptions ? 'Choose options' : 'View item',
            payload: { menuItemId: item.id, storeId: item.storeId },
          },
          ...(!hasOptions && item.store?.isOrderable
            ? [
                {
                  type: 'ADD_TO_CART' as const,
                  label: 'Add to cart',
                  payload: {
                    menuItemId: item.id,
                    quantity: 1,
                    itemName: item.name,
                    merchantName: item.store?.name,
                  },
                },
              ]
            : []),
        ],
      };
    });
    if (components.length === 0) {
      groups
        .filter((group) => merchantName || !(group.matchedItems || []).length)
        .slice(0, MAX_DISCOVERY_CARDS)
        .forEach((group) => {
          components.push({
            id: `merchant:${group.store.id}`,
            type: 'merchant_card',
            title: group.store.name,
            subtitle: `${group.store.category} · ${group.store.availabilityLabel || 'Available'}`,
            imageUrl: group.store.coverImage || undefined,
            data: {
              merchantId: group.store.id,
              merchantName: group.store.name,
              category: group.store.category,
              location: group.store.location,
              isOpen: group.store.isOpen,
              isOrderable: group.store.isOrderable,
            },
            actions: [
              {
                type: 'OPEN_MERCHANT',
                label: 'View merchant',
                payload: {
                  storeId: group.store.id,
                  merchantName: group.store.name,
                },
              },
            ],
          });
        });
    }
    if (locationRequired || locationMismatch) {
      components.push({
        id: 'location:required',
        type: 'navigation_card',
        title: 'Choose your delivery location',
        subtitle: requestedLocation
          ? `Set your delivery location to ${requestedLocation} to see merchants that serve that area.`
          : 'I need your selected location to show merchants that can serve you.',
        actions: [{ type: 'OPEN_LOCATION', label: 'Set location' }],
      });
    }

    const matchedStoreIds = new Set(
      matches.map((item) => String(item.storeId || '')).filter(Boolean),
    );
    const relevantGroups = matches.length
      ? groups.filter((group) => matchedStoreIds.has(String(group.store?.id)))
      : groups.filter(
          (group) => merchantName || !(group.matchedItems || []).length,
        );

    return {
      modelContent: {
        query,
        queries,
        merchantName: merchantName || null,
        count: matches.length || relevantGroups.length,
        itemCount: matches.length,
        merchantCount: relevantGroups.length,
        locationScoped: !locationRequired && !locationMismatch,
        locationRequired,
        selectedLocation: this.publicLocation(selectedLocation),
        requestedLocation: requestedLocation || null,
        locationMismatch,
        merchants: relevantGroups
          .slice(0, MAX_DISCOVERY_CARDS)
          .map((group) => ({
            merchantId: group.store?.id,
            name: group.store?.name,
            category: group.store?.category,
            location: group.store?.location,
            distanceKm: group.store?.distanceKm,
            isOpen: group.store?.isOpen,
            isOrderable: group.store?.isOrderable,
          })),
        items: matchesWithOptions.map((item) => ({
          menuItemId: item.id,
          name: item.name,
          merchantId: item.storeId,
          merchantName: item.store?.name,
          location: item.store?.location,
          distanceKm: item.store?.distanceKm,
          price: Number(item.finalPrice ?? item.price),
          isOpen: item.store?.isOpen,
          description:
            this.optionalString(
              item.description,
              MAX_CATALOG_DESCRIPTION_LENGTH,
            ) || null,
          optionGroups: this.compactOptionGroups(item.optionGroups),
          optionsTruncated: item.optionGroups.some(
            (group: any, groupIndex: number) =>
              groupIndex >= MAX_CONTEXT_OPTION_GROUPS ||
              (group.choices || []).length > MAX_CONTEXT_OPTION_CHOICES,
          ),
        })),
      },
      components,
    };
  }

  private async listNearbyMerchants(
    input: Record<string, unknown>,
    userId: string,
  ): Promise<AiToolResult> {
    const categories = Object.values(StoreCategory);
    const category = categories.includes(input.category as StoreCategory)
      ? (input.category as StoreCategory)
      : undefined;
    const discovery = await this.storeService.getCustomerDiscoveryStoresForUser(
      userId,
      category,
    );
    const requestedLocation = this.optionalString(input.requestedLocation, 100);
    const unfilteredStores = discovery.stores;
    const locationMismatch = Boolean(
      requestedLocation &&
      discovery.selectedLocation &&
      !this.locationMatchesRequest(
        discovery.selectedLocation,
        requestedLocation,
      ),
    );
    const matchingStores = locationMismatch ? [] : unfilteredStores;
    const stores = matchingStores.slice(0, MAX_TOOL_RESULTS);
    const components: AiComponent[] = stores.map((store) => ({
      id: `merchant:${store.id}`,
      type: 'merchant_card',
      title: store.name,
      subtitle: `${store.category} · ${store.availabilityLabel}`,
      imageUrl: store.coverImage || undefined,
      data: {
        merchantId: store.id,
        merchantName: store.name,
        category: store.category,
        location: store.location,
        isOpen: store.isOpen,
        isOrderable: store.isOrderable,
      },
      actions: [
        {
          type: 'OPEN_MERCHANT',
          label: 'View merchant',
          payload: { storeId: store.id, merchantName: store.name },
        },
      ],
    }));
    if (discovery.locationRequired || locationMismatch) {
      components.push({
        id: 'location:required',
        type: 'navigation_card',
        title: 'Choose your delivery location',
        subtitle: requestedLocation
          ? `Set your delivery location to ${requestedLocation} to see merchants that serve that area.`
          : 'I need your selected location to show merchants that can serve you.',
        actions: [{ type: 'OPEN_LOCATION', label: 'Set location' }],
      });
    }
    return {
      modelContent: {
        category: category || null,
        locationRequired: discovery.locationRequired,
        selectedLocation: this.publicLocation(discovery.selectedLocation),
        requestedLocation: requestedLocation || null,
        locationMismatch,
        count: stores.length,
        merchants: stores.map((store) => ({
          merchantId: store.id,
          name: store.name,
          category: store.category,
          location: store.location,
          isOpen: store.isOpen,
          isOrderable: store.isOrderable,
        })),
      },
      components,
    };
  }

  private async getWalletBalance(userId: string): Promise<AiToolResult> {
    const wallet = await this.walletService.getWallet(userId);
    const balance = Number(wallet?.walletBalance || 0);
    return {
      modelContent: { balance, currency: 'NGN' },
      components: [
        {
          id: 'wallet:current',
          type: 'wallet_card',
          title: `₦${balance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
          subtitle: 'Cushcoin wallet balance',
          data: { balance, currency: 'NGN' },
          actions: [{ type: 'OPEN_WALLET', label: 'Open wallet' }],
        },
      ],
    };
  }

  private async getRecentOrders(
    input: Record<string, unknown>,
    userId: string,
  ): Promise<AiToolResult> {
    const orders = await this.ordersRepository.find({
      where: { userId },
      relations: ['store', 'orderItems'],
      order: { createdAt: 'DESC' },
      take: MAX_TOOL_RESULTS,
    });
    const data = orders.map((order) => ({
      orderId: order.id,
      merchantName: order.store?.name || 'Delivery',
      status: order.status,
      total: Number(order.totalAmount || 0),
      createdAt: order.createdAt,
      items: (order.orderItems || []).slice(0, 12).map((item) => ({
        name: item.name,
        quantity: this.safeQuantity(item.quantity),
        unitPrice: Number(item.price || 0),
        selectedOptions: (item.selectedOptions || [])
          .slice(0, MAX_CONTEXT_OPTION_GROUPS)
          .map((group) => ({
            groupName: group.groupName,
            choices: (group.choices || [])
              .slice(0, MAX_CONTEXT_OPTION_CHOICES)
              .map((choice) => choice.name),
          })),
      })),
    }));
    return {
      modelContent: { orders: data },
      components:
        input.includeCards === false
          ? []
          : data.map((order) => this.orderComponent(order)),
    };
  }

  private async getOrderStatus(
    input: Record<string, unknown>,
    userId: string,
  ): Promise<AiToolResult> {
    const intent = input.intent === 'track' ? 'track' : 'status';
    let orderId = this.optionalString(input.orderId, 100);
    if (!orderId) {
      const active = await this.ordersRepository.findOne({
        where: {
          userId,
          status: In([
            OrderStatus.pending,
            OrderStatus.acknoledged,
            OrderStatus.picked_up,
            OrderStatus.in_transit,
          ]),
        },
        relations: ['store'],
        order: { createdAt: 'DESC' },
      });
      orderId = active?.id;
    }
    if (!orderId) {
      return { modelContent: { found: false, reason: 'NO_ACTIVE_ORDER' } };
    }
    const orderResponse = await this.ordersService.findByIdForUser(
      orderId,
      userId,
    );
    const order = orderResponse.toJSON().data as any;
    const data = {
      found: true,
      orderId: order.id,
      merchantName: order.store?.name || 'Delivery',
      status: order.status,
      total: Number(order.totalAmount || 0),
      createdAt: order.createdAt,
    };
    return {
      modelContent: { ...data, requestedIntent: intent },
      components: [
        this.orderComponent(data, intent === 'track' ? 'track' : 'view', true),
      ],
    };
  }

  private async getCart(): Promise<AiToolResult> {
    const response = await this.cartService.getCartDetails();
    const cart = (response.toJSON().data || null) as Record<string, any> | null;
    const rawItems = Array.isArray(cart?.cartItems) ? cart.cartItems : [];
    const items = rawItems.slice(0, 20).map((item: Record<string, any>) => ({
      menuItemId: item.menuItemId || item.menuItem?.id || item.id,
      name: item.menuItem?.name || item.name || 'Item',
      quantity: this.safeQuantity(item.quantity),
      unitPrice: Number(item.finalPrice ?? item.price ?? 0),
    }));
    const summarizedCart = cart
      ? {
          distinctItems: rawItems.length,
          itemCount: rawItems.reduce(
            (total: number, item: Record<string, any>) =>
              total + this.safeQuantity(item.quantity),
            0,
          ),
          subtotal: Number(cart.subtotal ?? cart.totalAmount ?? 0),
          merchantName:
            cart.store?.name || cart.merchantName || cart.storeName || null,
          items,
        }
      : null;
    return {
      modelContent: { cart: summarizedCart },
      components: summarizedCart
        ? [
            {
              id: 'cart:current',
              type: 'cart_card',
              title: 'Your cart',
              subtitle:
                'Review items, delivery address and charges before payment.',
              data: summarizedCart,
              actions: [{ type: 'OPEN_CART', label: 'Review cart' }],
            },
          ]
        : [],
    };
  }

  private async prepareAddToCart(
    input: Record<string, unknown>,
    userId: string,
  ): Promise<AiToolResult> {
    const menuItemId = this.requiredString(input.menuItemId, 'menuItemId', 100);
    const quantity = this.safeQuantity(input.quantity);
    const selectedOptions = this.selectedOptionInput(input.selectedOptions);
    const item = await this.menuItemService.findMenuItemAttachStore(menuItemId);
    if (!item?.isAvailable)
      throw new BadRequestException('MENU_ITEM_UNAVAILABLE');
    const eligibleStoreIds =
      await this.storeService.getCustomerDiscoveryStoreIdsForUser(userId);
    if (eligibleStoreIds === null) {
      throw new BadRequestException('DELIVERY_LOCATION_REQUIRED');
    }
    if (eligibleStoreIds && !eligibleStoreIds.includes(item.storeId)) {
      throw new BadRequestException('MENU_ITEM_OUTSIDE_SELECTED_LOCATION');
    }
    await this.storeService.assertStoreCanAcceptOrders(item.storeId);
    const optionGroups =
      await this.menuItemService.getPublishedOptionGroups(item);
    const missingRequiredOption = optionGroups.some(
      (group) =>
        group.isRequired &&
        !selectedOptions.some(
          (selection) =>
            selection.groupId === group.id && selection.choiceIds.length > 0,
        ),
    );
    if (missingRequiredOption) {
      const component: AiComponent = {
        id: `product-options:${item.id}`,
        type: 'product_card',
        title: item.name,
        subtitle: item.store?.name,
        imageUrl: item.images?.[0],
        data: {
          menuItemId: item.id,
          merchantId: item.storeId,
          price: this.menuItemService.getFinalMenuPrice(item),
          currency: 'NGN',
          hasOptions: true,
        },
        actions: [
          {
            type: 'OPEN_PRODUCT',
            label: 'Choose options',
            payload: { menuItemId: item.id, storeId: item.storeId },
          },
        ],
      };
      return {
        modelContent: {
          validated: true,
          readyToAdd: false,
          reason: 'REQUIRED_MENU_OPTION_MISSING',
          menuItemId: item.id,
          name: item.name,
          merchantName: item.store?.name,
          availableOptions: this.compactOptionGroups(optionGroups),
        },
        components: [component],
      };
    }
    const resolvedOptions = await this.menuItemService.resolveSelectedOptions(
      item,
      selectedOptions,
      optionGroups,
    );
    const price =
      this.menuItemService.getFinalMenuPrice(item) +
      resolvedOptions.optionPrice;
    const optionSummary = resolvedOptions.selectedOptions
      .slice(0, MAX_CONTEXT_OPTION_GROUPS)
      .map(
        (group) =>
          `${group.groupName}: ${group.choices
            .slice(0, MAX_CONTEXT_OPTION_CHOICES)
            .map((choice) => choice.name)
            .join(', ')}`,
      )
      .join(' · ')
      .slice(0, 240);
    const component: AiComponent = {
      id: `product-confirm:${item.id}`,
      type: 'product_card',
      title: item.name,
      subtitle: [item.store?.name, optionSummary].filter(Boolean).join(' · '),
      imageUrl: item.images?.[0],
      data: {
        menuItemId: item.id,
        merchantId: item.storeId,
        quantity,
        price,
        currency: 'NGN',
      },
      actions: [
        {
          type: 'ADD_TO_CART',
          label: `Add ${quantity} to cart`,
          payload: {
            menuItemId: item.id,
            storeId: item.storeId,
            quantity,
            itemName: item.name,
            merchantName: item.store?.name,
            selectedOptions,
          },
        },
      ],
    };
    return {
      modelContent: {
        validated: true,
        menuItemId: item.id,
        name: item.name,
        merchantName: item.store?.name,
        quantity,
        unitPrice: price,
        selectedOptions: resolvedOptions.selectedOptions
          .slice(0, MAX_CONTEXT_OPTION_GROUPS)
          .map((group) => ({
            groupName: group.groupName,
            choices: group.choices
              .slice(0, MAX_CONTEXT_OPTION_CHOICES)
              .map((choice) => choice.name),
          })),
      },
      components: [component],
    };
  }

  private async prepareCheckout(
    input: Record<string, unknown>,
    userId: string,
  ): Promise<AiToolResult> {
    const fullHouseAddress = this.requiredString(
      input.fullHouseAddress,
      'fullHouseAddress',
      300,
    );
    const noteForRider = this.optionalString(input.noteForRider, 500) || '';
    const noteForStore = this.optionalString(input.noteForStore, 500) || '';
    const additionalPhoneNumber = this.optionalString(
      input.additionalPhoneNumber,
      30,
    );
    // Read only: preparing a quote must not create an empty cart as a side
    // effect for users whose cart does not exist.
    const cart = await this.cartService.getCart(userId);
    if (!cart?.cartItems?.length || !cart.storeId) {
      throw new BadRequestException('CART_NOT_FOUND');
    }
    const store = await this.storeService.assertStoreCanAcceptOrders(
      cart.storeId,
    );
    const pickUpLocationId = store.addressId || cart.pickUpLocationId;
    if (!cart.dropOffLocationId) {
      throw new BadRequestException('DELIVERY_LOCATION_REQUIRED');
    }
    if (!pickUpLocationId) {
      throw new BadRequestException('CART_NOT_READY');
    }
    const chargeResponse = await this.calculateDeliveryUseCase.execute(
      pickUpLocationId,
      cart.dropOffLocationId,
      VehicleType.bike,
      OrderTypes.q_commerce,
    );
    const chargeData = chargeResponse.toJSON().data as any;
    const subtotal = Number(cart.totalAmount || 0);
    const platformFee = Number(cart.subtotalBeforeDiscount || subtotal) * 0.04;
    const deliveryAndServiceFees = Number(chargeData?.totalCharges || 0);
    const total = subtotal + platformFee + deliveryAndServiceFees;
    let wallet = await this.walletService.getWallet(userId);
    if (!wallet) wallet = await this.walletService.getOrCreateWallet(userId);
    const walletBalance = Number(wallet.walletBalance || 0);
    const shortfall = Math.max(0, total - walletBalance);
    const orderPayload = {
      storeId: cart.storeId,
      pickUpLocationId,
      dropOffLocationId: cart.dropOffLocationId,
      vechicleType: VehicleType.bike,
      noteForVendor: noteForStore,
      noteForStore,
      noteForRider,
      scheduleDelivery: false,
      buyForFriend: false,
      fullHouseAddress,
      ...(additionalPhoneNumber ? { additionalPhoneNumber } : {}),
    };
    const visibleItems = cart.cartItems.slice(0, 8);
    const summary = {
      items: visibleItems.map((item) => ({
        name: item.name,
        quantity: this.safeQuantity(item.quantity),
        unitPrice: Number(item.price || 0),
      })),
      itemCount: cart.cartItems.length,
      omittedItemCount: Math.max(
        0,
        cart.cartItems.length - visibleItems.length,
      ),
      subtotal,
      deliveryAndServiceFees,
      platformFee,
      total,
      walletBalance,
      shortfall,
      fullHouseAddress,
      noteForRider,
      noteForStore,
    };
    if (shortfall > 0) {
      let fundingAccount: Record<string, unknown> | null = null;
      try {
        const response = await this.getVirtualAccountUseCase.execute(wallet.id);
        fundingAccount = (response.toJSON().data || null) as any;
      } catch {
        fundingAccount = null;
      }
      return {
        modelContent: {
          ready: false,
          reason: 'INSUFFICIENT_FUND',
          ...summary,
          fundingAccount,
        },
        components: [
          {
            id: `checkout-funding:${cart.id}`,
            type: 'funding_card',
            title: `Top up ${this.currency(shortfall)} to continue`,
            subtitle: fundingAccount
              ? 'Transfer the exact shortfall to your Cushcoin account below.'
              : 'Open Cushcoin to fund your wallet, then recheck checkout.',
            data: { ...summary, fundingAccount },
            actions: [
              {
                type: 'REFRESH_CHECKOUT',
                label: "I've funded — recheck",
                payload: orderPayload,
              },
              { type: 'OPEN_WALLET', label: 'Open Cushcoin' },
            ],
          },
        ],
      };
    }
    return {
      modelContent: { ready: true, ...summary },
      components: [
        {
          id: `checkout-review:${cart.id}`,
          type: 'checkout_card',
          title: 'Review and confirm your order',
          subtitle: 'Live fees and wallet balance checked.',
          data: { ...summary, price: total },
          actions: [
            {
              type: 'CONFIRM_ORDER',
              label: `Confirm · ${this.currency(total)}`,
              payload: orderPayload,
            },
          ],
        },
      ],
    };
  }

  private openSupport(input: Record<string, unknown>): AiToolResult {
    const reason = this.optionalString(input.reason, 300);
    return {
      modelContent: { handoffAvailable: true, reason },
      components: [
        {
          id: 'support:handoff',
          type: 'support_card',
          title: 'Talk to Cushy Support',
          subtitle: reason || 'Continue with a human support specialist.',
          actions: [
            {
              type: 'OPEN_SUPPORT',
              label: 'Contact support',
              payload: { reason },
            },
          ],
        },
      ],
    };
  }

  private openHealthConsultation(input: Record<string, unknown>): AiToolResult {
    const urgent = input.urgent === true;
    const reason = this.optionalString(input.reason, 300);
    return {
      modelContent: { consultationAvailable: true, urgent, reason },
      components: [
        {
          id: urgent ? 'health:urgent' : 'health:consultation',
          type: urgent ? 'emergency_card' : 'navigation_card',
          title: urgent
            ? 'Get medical help now'
            : 'Speak with a health professional',
          subtitle: reason,
          actions: [
            {
              type: 'OPEN_HEALTH_CONSULTATION',
              label: 'Find a health professional',
              payload: { urgent, reason },
            },
            ...(urgent
              ? ([
                  { type: 'CALL_EMERGENCY', label: 'Call emergency services' },
                ] as const)
              : []),
          ],
        },
      ],
    };
  }

  private orderComponent(
    order: any,
    actionIntent: 'view' | 'track' = 'view',
    currentOrderIntent = false,
  ): AiComponent {
    const action =
      actionIntent === 'track'
        ? {
            type: 'OPEN_ORDER_TRACKING' as const,
            label: 'Track order',
            payload: { orderId: order.orderId, status: order.status },
          }
        : {
            type: 'OPEN_ORDER' as const,
            label: 'View order',
            payload: { orderId: order.orderId, status: order.status },
          };
    return {
      id: `order:${order.orderId}`,
      type: 'order_card',
      title: order.merchantName || 'Delivery',
      subtitle: `Order ${order.orderId} · ${order.status}`,
      data: {
        orderId: order.orderId,
        merchantName: order.merchantName,
        status: order.status,
        total: order.total,
        createdAt: order.createdAt,
        ...(currentOrderIntent ? { currentOrderIntent: true } : {}),
      },
      actions: [action],
    };
  }

  private requiredString(
    value: unknown,
    field: string,
    maxLength: number,
  ): string {
    const result = this.optionalString(value, maxLength);
    if (!result)
      throw new BadRequestException(`INVALID_${field.toUpperCase()}`);
    return result;
  }

  private optionalString(
    value: unknown,
    maxLength: number,
  ): string | undefined {
    return typeof value === 'string'
      ? value.trim().slice(0, maxLength) || undefined
      : undefined;
  }

  private optionalStringArray(
    value: unknown,
    maxItems: number,
    maxLength: number,
  ): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.optionalString(item, maxLength))
      .filter((item): item is string => Boolean(item))
      .filter(
        (item, index, all) =>
          all.findIndex(
            (candidate) => candidate.toLowerCase() === item.toLowerCase(),
          ) === index,
      )
      .slice(0, maxItems);
  }

  private async attachPublishedOptions(items: Array<any>): Promise<Array<any>> {
    const optionItems = items.filter(
      (item) =>
        Array.isArray(item.optionGroupIds) && item.optionGroupIds.length,
    );
    if (!optionItems.length) {
      return items.map((item) => ({ ...item, optionGroups: [] }));
    }

    const groupsByItem =
      await this.menuItemService.getPublishedOptionGroupsForItems(optionItems);
    return items.map((item) => ({
      ...item,
      optionGroups: groupsByItem[item.id] || [],
    }));
  }

  private compactOptionGroups(groups: Array<any> = []): Array<any> {
    return groups.slice(0, MAX_CONTEXT_OPTION_GROUPS).map((group) => ({
      groupId: group.id,
      name: group.name,
      required: group.isRequired === true,
      allowMultiple: group.allowMultiple === true,
      choices: (group.choices || [])
        .slice(0, MAX_CONTEXT_OPTION_CHOICES)
        .map((choice: any) => ({
          choiceId: choice.id,
          name: choice.name,
          priceAdjustment: Number(choice.priceAdjustment || 0),
        })),
    }));
  }

  private selectedOptionInput(
    value: unknown,
  ): Array<{ groupId: string; choiceIds: string[] }> {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 20) {
      throw new BadRequestException('INVALID_MENU_OPTION_SELECTION');
    }

    const seenGroups = new Set<string>();
    return value.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        throw new BadRequestException('INVALID_MENU_OPTION_SELECTION');
      }
      const selection = entry as Record<string, unknown>;
      const groupId = this.optionalString(selection.groupId, 100);
      const rawChoiceIds = selection.choiceIds;
      if (
        !groupId ||
        seenGroups.has(groupId) ||
        !Array.isArray(rawChoiceIds) ||
        rawChoiceIds.length === 0 ||
        rawChoiceIds.length > 30
      ) {
        throw new BadRequestException('INVALID_MENU_OPTION_SELECTION');
      }
      const choiceIds = rawChoiceIds.map((choiceId) => {
        const result = this.optionalString(choiceId, 100);
        if (!result) {
          throw new BadRequestException('INVALID_MENU_OPTION_SELECTION');
        }
        return result;
      });
      if (new Set(choiceIds).size !== choiceIds.length) {
        throw new BadRequestException('INVALID_MENU_OPTION_SELECTION');
      }
      seenGroups.add(groupId);
      return { groupId, choiceIds };
    });
  }

  private selectDiverseCatalogMatches(
    items: Array<any>,
    queries: string[],
    limit: number,
  ): Array<any> {
    const queues = queries.map((query) =>
      items
        .map((item) => ({
          item,
          score: this.catalogNameMatchScore(item?.name, query),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => {
          if (right.score !== left.score) return right.score - left.score;
          const rightOrderable =
            right.item?.store?.isOrderable === true ? 1 : 0;
          const leftOrderable = left.item?.store?.isOrderable === true ? 1 : 0;
          if (rightOrderable !== leftOrderable) {
            return rightOrderable - leftOrderable;
          }
          const leftDistance = left.item?.store?.distanceKm;
          const rightDistance = right.item?.store?.distanceKm;
          const leftDistanceKnown =
            typeof leftDistance === 'number' && Number.isFinite(leftDistance);
          const rightDistanceKnown =
            typeof rightDistance === 'number' && Number.isFinite(rightDistance);
          if (leftDistanceKnown && rightDistanceKnown) {
            return leftDistance - rightDistance;
          }
          if (leftDistanceKnown) return -1;
          if (rightDistanceKnown) return 1;
          return String(left.item?.name || '').localeCompare(
            String(right.item?.name || ''),
          );
        }),
    );
    const selected: Array<any> = [];
    const selectedIds = new Set<string>();
    while (selected.length < limit) {
      let added = false;
      for (const queue of queues) {
        let candidate = queue.shift();
        while (candidate && selectedIds.has(String(candidate.item?.id || ''))) {
          candidate = queue.shift();
        }
        if (!candidate) continue;
        const id = String(candidate.item?.id || '');
        if (!id) continue;
        selectedIds.add(id);
        selected.push(candidate.item);
        added = true;
        if (selected.length >= limit) break;
      }
      if (!added) break;
    }
    return selected;
  }

  private catalogNameMatchScore(itemName: unknown, query: string): number {
    const name = String(itemName || '')
      .trim()
      .toLowerCase();
    const normalizedQuery = query.trim().toLowerCase();
    if (!name || !normalizedQuery) return 0;
    if (name === normalizedQuery) return 4;
    if (name.includes(normalizedQuery)) return 3;
    const tokens = this.searchTokens(query);
    const matchedTokens = tokens.filter((token) => name.includes(token));
    if (matchedTokens.length === tokens.length) return 2;
    return matchedTokens.length > 0 ? 1 : 0;
  }

  private safeQuantity(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 1;
    return Math.min(20, Math.max(1, Math.floor(numeric)));
  }

  private locationMatchesRequest(
    merchantLocation: unknown,
    requestedLocation: string,
  ): boolean {
    const merchantTokens = new Set(this.locationTokens(merchantLocation));
    const requestedTokens = this.locationTokens(requestedLocation);
    return (
      requestedTokens.length > 0 &&
      requestedTokens.every((token) => merchantTokens.has(token))
    );
  }

  private publicLocation(value: unknown): Record<string, string | null> | null {
    if (!value || typeof value !== 'object') return null;
    const location = value as Record<string, unknown>;
    const clean = (field: string) =>
      typeof location[field] === 'string'
        ? String(location[field]).trim() || null
        : null;
    return {
      city: clean('city'),
      state: clean('state'),
      country: clean('country'),
    };
  }

  private locationTokens(value: unknown): string[] {
    const text =
      typeof value === 'string'
        ? value
        : value && typeof value === 'object'
          ? Object.values(value as Record<string, unknown>)
              .filter((part): part is string => typeof part === 'string')
              .join(' ')
          : '';
    if (!text) return [];
    const ignored = new Set([
      'nigeria',
      'nigerian',
      'state',
      'city',
      'country',
      'area',
      'the',
      'road',
      'rd',
      'street',
      'st',
      'avenue',
      'ave',
      'close',
      'crescent',
      'lane',
      'layout',
      'plaza',
      'junction',
      'phase',
      'zone',
    ]);
    return text
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((token) => token.length >= 2 && !ignored.has(token));
  }

  private searchTokens(query: string): string[] {
    const ignored = new Set([
      'a',
      'an',
      'and',
      'buy',
      'find',
      'for',
      'food',
      'foods',
      'from',
      'get',
      'i',
      'me',
      'of',
      'order',
      'please',
      'restaurant',
      'show',
      'some',
      'the',
      'to',
      'want',
      'with',
      'can',
      'could',
      'help',
      'health',
      'healthy',
      'friendly',
      'diet',
      'dietary',
      'high',
      'low',
      'manage',
      'managing',
      'meal',
      'meals',
      'my',
      'you',
      'would',
    ]);
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2 && !ignored.has(token));
    return tokens.length ? tokens : [query.toLowerCase()];
  }

  private currency(value: number): string {
    return `₦${Number(value || 0).toLocaleString('en-NG', {
      maximumFractionDigits: 2,
    })}`;
  }
}

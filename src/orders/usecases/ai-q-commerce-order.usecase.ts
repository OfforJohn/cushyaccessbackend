import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { In } from 'typeorm';
import { Orders } from '../model/order.entity';
import { CreateAIOrderDto } from '../model/dto/create-order.dto';
import { CommonService } from 'src/common/common.service';
import { WalletService } from 'src/wallet/services/wallet.service';
import { StandardResponse } from 'src/common/module/standard-response';
import { VehicleType } from '../model/enum/vechicle-type.enum';
import { ChargeNode } from '../model/charges/charge-node.entity';
import { OrderTypes } from '../model/enum/order-types.enum';
import { TransactionRequest } from '../../wallet/model/dto/transaction.request';
import { TransactionCategory } from '../../wallet/model/transaction-category.enum';
import { TransactionStatus } from '../../wallet/model/transaction-status.enum';
import { OrdersService } from '../services/orders.service';
import { TransactionService } from '../../wallet/services/transaction.service';
import { OrderCharges } from '../model/charges/order-charges.entity';
import { CartService } from '../services/cart.service';
import { StoreService } from '../../stores/services/stores.service';
import { MailSenderService } from 'src/user-otp/mail-sender.service';
import { PromoCodeService } from '../../promo-code/service/promo-code.service';
import { EventBus } from '@nestjs/cqrs';
import { PromoCodeConsumeEvent } from '../../wallet/events/promo-code-consume.event';
import { PushNotificationEvent } from '../../users/events/push-notification.event';
import { NotificationCategory } from '../../users/model/notification-category';
import { UserLocationsService } from 'src/users/services/user-locations.service';
import { MobileSenderService } from 'src/user-otp/mobile-sender.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { UsersService } from 'src/users/services/users.service';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { MenuItem } from 'src/stores/model/menu-item.entity';
import { MenuItemService } from 'src/stores/services/menu-item.service';
import { getMerchantSettlementBase } from '../merchant-settlement';

@Injectable()
export class AIQCommerceOrderUseCase {
  constructor(
    private readonly storeService: StoreService,
    private readonly cartService: CartService, // kept only if used elsewhere; not used here
    private readonly commonService: CommonService,
    private readonly walletService: WalletService,
    private readonly orderService: OrdersService,
    private readonly transactionService: TransactionService,
    private readonly mailSenderService: MailSenderService,
    private readonly promoCodeService: PromoCodeService,
    private readonly eventBus: EventBus,
    private readonly userLocationService: UserLocationsService,
    private readonly mobileSenderService: MobileSenderService,
    private readonly analyticsService: AnalyticsService,
    private readonly userService: UsersService,
    @InjectRepository(MenuItem)
    private readonly menuItemRepository: Repository<MenuItem>,
    private readonly menuItemService: MenuItemService,
  ) {}

  async execute(
    createOrderDto: CreateAIOrderDto,
    email: string,
  ): Promise<StandardResponse> {
    const {
      noteForRider,
      noteForVendor,
      noteForStore,
      scheduleDelivery,
      scheduleDeliveryDate,
      scheduleDeliveryTime,
      buyForFriend,
      friendName,
      friendNumber,
      friendDeliveryAddress,
      vechicleType,
      additionalPhoneNumber,
      promoCodeValue,
      selectedItems, // new field
    } = createOrderDto;

    const authenticatedUser = await this.userService.findByEmailOrMobile(email);

    if (authenticatedUser.location == null) {
      throw new BadRequestException(
        new StandardResponse(true, 'USER_LOCATION_NOT_FOUND'),
      );
    }

    // 1) Validate selected items
    if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
      throw new BadRequestException(
        new StandardResponse(true, 'NO_ITEMS_SELECTED'),
      );
    }
    if (
      selectedItems.some(
        (item) =>
          !item ||
          typeof item.menuItemId !== 'string' ||
          !item.menuItemId.trim() ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 99,
      )
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_ITEM_SELECTION'),
      );
    }

    // Fetch menu items by IDs
    const menuItemIds = [
      ...new Set(selectedItems.map((item) => item.menuItemId)),
    ];
    const menuItems = await this.menuItemRepository.find({
      where: { id: In(menuItemIds) },
      relations: ['store', 'menuCategory'],
    });

    if (menuItems.length !== menuItemIds.length) {
      throw new NotFoundException(
        new StandardResponse(true, 'SOME_MENU_ITEMS_NOT_FOUND'),
      );
    }
    if (menuItems.some((item) => !item.isAvailable)) {
      throw new BadRequestException(
        new StandardResponse(true, 'SOME_MENU_ITEMS_UNAVAILABLE'),
      );
    }

    // Ensure all items belong to the same store
    const storeId = menuItems[0].storeId;
    const allSameStore = menuItems.every((item) => item.storeId === storeId);
    if (!allSameStore) {
      throw new BadRequestException(
        new StandardResponse(true, 'ITEMS_FROM_DIFFERENT_STORES'),
      );
    }
    if (createOrderDto.storeId !== storeId) {
      throw new BadRequestException(
        new StandardResponse(true, 'ORDER_STORE_DOES_NOT_MATCH_ITEMS'),
      );
    }
    const optionGroupsByItem =
      await this.menuItemService.getPublishedOptionGroupsForItems(menuItems);

    // 2) Build order items and calculate totals
    let subtotalBeforeCharges = 0;
    let totalDiscount = 0; // can be extended later
    const orderItemsData = [];

    for (const selected of selectedItems) {
      const menuItem = menuItems.find((m) => m.id === selected.menuItemId);
      if (!menuItem) continue; // should not happen

      const finalPrice = this.menuItemService.getFinalMenuPrice(menuItem);
      const resolvedOptions = await this.menuItemService.resolveSelectedOptions(
        menuItem,
        selected.selectedOptions || [],
        optionGroupsByItem[menuItem.id] || [],
      );
      const configuredPrice = finalPrice + resolvedOptions.optionPrice;
      if (configuredPrice > 99999999.99) {
        throw new BadRequestException(
          new StandardResponse(true, 'CONFIGURED_MENU_ITEM_PRICE_TOO_LARGE'),
        );
      }
      const itemTotal = configuredPrice * selected.quantity;

      // If discount logic exists per item, calculate here
      const discount = 0; // placeholder

      subtotalBeforeCharges += itemTotal;
      totalDiscount += discount;

      orderItemsData.push({
        menuItemId: menuItem.id,
        name: menuItem.name,
        description: menuItem.description,
        quantity: selected.quantity,
        price: configuredPrice,
        selectedOptions: resolvedOptions.selectedOptions,
        optionPrice: resolvedOptions.optionPrice,
        configurationKey: resolvedOptions.configurationKey,
        discountAmount: discount,
        // Add customizations if needed
      });
    }

    const totalAmountBeforeCharges = subtotalBeforeCharges;
    const discountAmount = totalDiscount;
    const finalSubtotal = totalAmountBeforeCharges - discountAmount; // matches cart.totalAmount

    // 3) Resolve store and free delivery state
    const getStore =
      await this.storeService.assertStoreCanAcceptOrders(storeId);
    console.log('Resolved store for order:', getStore.id, getStore.name);
    const isFreeDelivery = await this.storeService.isFreeDeliveryActive();

    // 4) Retrieve wallets
    const userWallet = await this.walletService.getWallet(authenticatedUser.id);
    if (!userWallet) {
      console.error('Wallet not initialized for user:', authenticatedUser.id);
      throw new NotFoundException(
        new StandardResponse(true, 'USER_WALLET_NOT_INITIALIZED'),
      );
    }
    const vendorWallet = await this.walletService.getWallet(getStore.userId);
    if (!vendorWallet) {
      console.error('Wallet not initialized for vendor:', getStore.userId);
      throw new NotFoundException(
        new StandardResponse(true, 'VENDOR_WALLET_NOT_INITIALIZED'),
      );
    }

    // 5) Build order user if buying for friend
    let orderUser = null;
    if (buyForFriend) {
      orderUser = await this.orderService.initOrderUser({
        name: friendName,
        number: friendNumber,
        email: null,
        address: friendDeliveryAddress,
        addressId: authenticatedUser.locationId,
      });
    }

    // 6) Initialize order object (do NOT persist yet)
    const order = new Orders();
    order.userId = authenticatedUser.id;
    order.pickUpLocationId = getStore.addressId;
    order.dropOffLocationId = authenticatedUser.locationId;
    order.noteForRider = noteForRider;
    order.noteForVendor = noteForVendor;
    order.noteForStore = noteForStore;
    order.storeId = getStore.id;
    order.totalItems = orderItemsData.length;
    order.orderItems = []; // will fill after save
    order.totalAmount = 0;
    order.totalAmountBeforeCharges = totalAmountBeforeCharges;
    order.discountAmount = discountAmount;
    order.appliedCouponCode = null; // will be set later if promo code used
    order.Charges = 0;
    order.scheduleDelivery = scheduleDelivery ?? false;
    order.scheduleDeliveryDate = scheduleDelivery ? scheduleDeliveryDate : null;
    order.scheduleDeliveryTime = scheduleDelivery ? scheduleDeliveryTime : null;
    order.buyForFriend = buyForFriend ?? false;
    order.recipientInfo = orderUser;
    order.type = OrderTypes.q_commerce;
    order.additionalPhoneNumber = additionalPhoneNumber;
    order.fullHouseAddress = authenticatedUser.location.address;

    // 7) Calculate distance and charges (no DB writes yet)
    const { distanceInKm } = await this.orderService.calculateDeliveryDistance(
      getStore.addressId,
      authenticatedUser.locationId,
    );

    const appLevelCharges = await this.orderService.getAppLevelCharges();

    let deliveryFee = 0;
    if (!isFreeDelivery) {
      const vechicleDeliveryFee =
        vechicleType === VehicleType.bike
          ? appLevelCharges.deliveryFeePerKmForBike
          : appLevelCharges.deliveryFeePerKmForVan;
      deliveryFee = distanceInKm * (vechicleDeliveryFee + 1);
    }

    let totalCharges = deliveryFee;
    const chargeNodes: ChargeNode[] = [];

    if (!isFreeDelivery) {
      const deliveryFeeNode = new ChargeNode();
      deliveryFeeNode.amount = deliveryFee;
      deliveryFeeNode.name = 'deliveryFee';
      chargeNodes.push(deliveryFeeNode);
    }

    appLevelCharges.charges?.forEach((charge) => {
      if (charge.chargeCategory === OrderTypes.q_commerce) {
        const chargeNode = new ChargeNode();
        chargeNode.amount = charge.value;
        chargeNode.name = charge.name;
        chargeNodes.push(chargeNode);
        totalCharges += charge.value;
      }
    });

    // Platform fee (4%)
    const platformFee = Number(totalAmountBeforeCharges) * 0.04;
    totalCharges += platformFee;

    const platformFeeNode = new ChargeNode();
    platformFeeNode.amount = platformFee;
    platformFeeNode.name = 'platformFee';
    chargeNodes.push(platformFeeNode);

    const totalAmount = finalSubtotal + totalCharges;

    // 8) Check wallet balance BEFORE calling external services
    if (userWallet.walletBalance < totalAmount) {
      throw new BadRequestException(
        new StandardResponse(true, 'INSUFFICIENT_FUND'),
      );
    }

    // 9) Optional: validate promo code
    let promoCode;
    if (promoCodeValue) {
      promoCode = await this.promoCodeService.validatePromoCode(
        promoCodeValue,
        authenticatedUser.id,
      );
      // If promo code is applied, you might adjust totals here
      // For simplicity, we assume promo code discount is already reflected in `discountAmount`.
    }

    try {
      const dropOffAddress = await this.userLocationService.getLocationById(
        authenticatedUser.locationId,
      );
      order.dropOffLocationAddress = dropOffAddress.address;
    } catch (error: any) {
      console.error(
        'Failed to fetch drop-off location:',
        error.message || error,
      );
    }

    // 11) Now set order totals and persist the order
    order.Charges = totalCharges;
    order.totalAmount = totalAmount;
    const savedOrder = await this.orderService.updateOrder(order);

    // 12) Persist order items
    const orderItems = [];
    for (const itemData of orderItemsData) {
      const orderItem = this.orderService.initOrderItems(
        itemData,
        savedOrder.id,
      );
      await this.orderService.updateOrderItem(orderItem);
      orderItems.push(orderItem);
    }
    savedOrder.orderItems = orderItems;

    // 13) Persist orderCharges and chargeNodes
    const orderCharges = new OrderCharges();
    orderCharges.orderId = savedOrder.id;
    await this.orderService.saveOrderCharges(orderCharges);

    chargeNodes.forEach((node) => {
      node.orderChargesId = orderCharges.id;
    });
    await this.orderService.saveChargesNodes(chargeNodes);

    // 14) Update order charges summary
    await this.orderService.updateOrderCharges(
      totalAmount,
      totalCharges,
      savedOrder.id,
    );

    // 15) Deduct from user's wallet
    userWallet.walletBalance -= Number(totalAmount);
    await this.walletService.updateWallets([userWallet]);

    // 16) Create transactions
    const transaction = new TransactionRequest();
    transaction.userId = authenticatedUser.id;
    transaction.walletId = userWallet.id;
    transaction.amount = totalAmount;
    transaction.transactionReference = `CATX-${uuidv4()}`;
    transaction.description = 'ORDER_DEBIT';
    transaction.category = TransactionCategory.ORDER_DEBIT;
    transaction.status = TransactionStatus.COMPLETED;
    transaction.orderId = savedOrder.id;
    await this.transactionService.createTransaction(transaction);

    const vendorTransaction = new TransactionRequest();
    vendorTransaction.userId = getStore.userId;
    vendorTransaction.walletId = vendorWallet.id;
    vendorTransaction.amount = getMerchantSettlementBase(
      totalAmountBeforeCharges,
    );
    vendorTransaction.transactionReference = `CATX-${uuidv4()}`;
    vendorTransaction.description = 'ORDER_REWARD';
    vendorTransaction.orderId = savedOrder.id;
    vendorTransaction.category = TransactionCategory.Q_COMMERCE;
    vendorTransaction.status = TransactionStatus.AWAITING_DELIVERY;
    await this.transactionService.createTransaction(vendorTransaction);

    // 17) Initialize order tracking
    await this.orderService.initOrderTracking(savedOrder.id);

    // 18) Promo code consume & event (if applicable)
    if (promoCode) {
      await this.promoCodeService.consumePromoCode(
        promoCodeValue,
        authenticatedUser,
      );
      this.eventBus.publish(
        new PromoCodeConsumeEvent(
          promoCode,
          authenticatedUser.id,
          savedOrder.id,
        ),
      );
    }

    // 19) Send SMS and push notification
    await this.mobileSenderService.sendOrderSmsNotif(
      getStore.mobile,
      authenticatedUser.mobile,
      (savedOrder.buyForFriend
        ? savedOrder.recipientInfo?.deliveryAddress
        : savedOrder.dropOffLocationAddress) ||
        savedOrder.dropOffLocationAddress ||
        savedOrder.fullHouseAddress,
      savedOrder.totalAmountBeforeCharges,
      `${getStore.user?.firstName || ''} ${getStore.user?.lastName || ''}`.trim() ||
        getStore.name ||
        '',
      getStore.user?.callingCode,
      authenticatedUser.callingCode,
    );

    this.eventBus.publish(
      new PushNotificationEvent(
        getStore.userId,
        NotificationCategory.VENDOR_RECEIVE_ORDER,
        `N${savedOrder.totalAmountBeforeCharges}`,
      ),
    );
    // 20) Send email
    const content = {
      customerName:
        authenticatedUser.firstName + ' ' + authenticatedUser.lastName,
      orderDate: new Date().toLocaleDateString(),
      storeName: getStore.name,
      storeAddress: getStore.address.address,
      deliveryFee: savedOrder.Charges,
      isFreeDelivery,
      totalAmount: savedOrder.totalAmount,
      items: orderItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        options: (item.selectedOptions || [])
          .map(
            (group) =>
              `${group.groupName}: ${group.choices
                .map((choice) => choice.name)
                .join(', ')}`,
          )
          .join('; '),
      })),
      currentYear: new Date().getFullYear(),
    };

    this.mailSenderService.sendMail({
      recipient: authenticatedUser.email,
      subject: 'Order Confirmation - Cushy Access',
      content,
      template: 'order-confirmation',
      bcc: [
        'ornagletransact@gmail.com',
        'bolaji2438@gmail.com',
        'cameal.minna@gmail.com',
      ],
    });

    await this.analyticsService.trackUserActivity(
      authenticatedUser.id,
      'order_placed',
      {
        orderId: savedOrder.id,
        amount: savedOrder.totalAmount,
      },
    );

    return new StandardResponse(
      false,
      'ORDER_CREATED_SUCCESSFULLY',
      savedOrder,
    );
  }
}

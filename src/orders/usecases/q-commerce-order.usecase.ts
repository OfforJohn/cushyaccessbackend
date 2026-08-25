import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { randomInt } from 'crypto';
import { Orders } from '../model/order.entity';
import { CreateOrderDto } from '../model/dto/create-order.dto';
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
import { MobileSenderService } from 'src/user-otp/mobile-sender.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { composeDeliveryAddress } from '../delivery-address';
import { getMerchantSettlementBase } from '../merchant-settlement';

@Injectable()
export class QCommerceOrderUseCase {
  constructor(
    private readonly storeService: StoreService,
    private readonly cartService: CartService,
    private readonly commonService: CommonService,
    private readonly walletService: WalletService,
    private readonly orderService: OrdersService,
    private readonly transactionService: TransactionService,
    private readonly mailSenderService: MailSenderService,
    private readonly promoCodeService: PromoCodeService,
    private readonly eventBus: EventBus,
    private readonly mobileSenderService: MobileSenderService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  /**
   * Generates a random numeric verification code (default 6 digits),
   * zero-padded so it's always the requested length even if the random
   * number is small (e.g. "004821" instead of "4821").
   * Used for both pickup and delivery confirmation codes.
   */
  private generateVerificationCode(length = 6): string {
    const max = 10 ** length;
    const code = randomInt(0, max);
    return code.toString().padStart(length, '0');
  }

  async execute(createOrderDto: CreateOrderDto): Promise<StandardResponse> {
    const {
      dropOffLocationId,
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
      fullHouseAddress,
      additionalPhoneNumber,
      promoCodeValue,
    } = createOrderDto;

    const authenticatedUser = await this.commonService.getLoggedInUser();

    const normalizedFullAddress = fullHouseAddress?.trim();
    const normalizedFriendAddress = friendDeliveryAddress?.trim();
    const addressDetails =
      normalizedFullAddress ||
      (buyForFriend ? normalizedFriendAddress : undefined);

    // 1) Retrieve user's cart with items
    const cart = await this.cartService.getCart(authenticatedUser.id);
    if (!cart || cart.cartItems.length === 0) {
      throw new NotFoundException(
        new StandardResponse(true, 'USER_CART_NOT_FOUND'),
      );
    }

    // Prices, merchant discounts, and coupon validity can change while a cart
    // is open. Recalculate immediately before charging so both the customer
    // debit and merchant settlement use one current snapshot.
    // Revalidate choices at the payment boundary in case the merchant changed
    // or removed an option after the customer added the item.
    await this.cartService.calculateCartAmounts(cart, undefined, true);

    // 2) Resolve store and free delivery state
    const getStore = await this.storeService.assertStoreCanAcceptOrders(
      cart.storeId,
    );
    const selectedDropOffLocation =
      await this.orderService.getLocationById(dropOffLocationId);
    const isFreeDelivery = await this.storeService.isFreeDeliveryActive();

    // 3) Retrieve wallets
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

    // 4) Build order user if buying for friend
    let orderUser = null;
    if (buyForFriend) {
      orderUser = await this.orderService.initOrderUser({
        name: friendName,
        number: friendNumber,
        email: null,
        address: addressDetails,
        addressId: dropOffLocationId,
      });
    }

    // 5) Initialize order object (do NOT persist yet)
    const order = new Orders();
    order.userId = authenticatedUser.id;
    order.pickUpLocationId = getStore.addressId;
    order.dropOffLocationId = dropOffLocationId;
    order.dropOffLocationAddress = selectedDropOffLocation.address;
    order.noteForRider = noteForRider;
    order.noteForVendor = noteForVendor;
    order.noteForStore = noteForStore;
    order.storeId = getStore.id;
    order.totalItems = cart.cartItems.length;
    order.orderItems = [];
    order.totalAmount = 0;
    order.totalAmountBeforeCharges = cart.subtotalBeforeDiscount;
    order.discountAmount = cart.discountAmount ?? 0;
    order.appliedCouponCode = cart.appliedCouponCode ?? null;
    order.Charges = 0;
    order.scheduleDelivery = scheduleDelivery ?? false;
    order.scheduleDeliveryDate = scheduleDelivery ? scheduleDeliveryDate : null;
    order.scheduleDeliveryTime = scheduleDelivery ? scheduleDeliveryTime : null;
    order.buyForFriend = buyForFriend ?? false;
    order.recipientInfo = orderUser;
    order.type = OrderTypes.q_commerce;
    order.additionalPhoneNumber = additionalPhoneNumber;
    order.fullHouseAddress = addressDetails;

    // 5b) Pickup & delivery verification codes
    // pickupCode: shown to the rider/vendor to confirm the rider actually
    //             picked the order up from the store.
    // deliveryCode: shared with the customer (and buyForFriend recipient) to
    //             confirm the rider actually handed the order over on delivery.
    order.pickupCode = this.generateVerificationCode();
    order.deliveryCode = this.generateVerificationCode();

    // 6) Calculate distance and charges (no DB writes yet)
    const { distanceInKm } = await this.orderService.calculateDeliveryDistance(
      getStore.addressId,
      dropOffLocationId,
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

    const platformFee = Number(order.totalAmountBeforeCharges) * 0.04;
    totalCharges += platformFee;

    const platformFeeNode = new ChargeNode();
    platformFeeNode.amount = platformFee;
    platformFeeNode.name = 'platformFee';
    chargeNodes.push(platformFeeNode);

    const totalAmount = Number(cart.totalAmount) + Number(totalCharges);

    // 7) Check wallet balance BEFORE calling external services
    if (userWallet.walletBalance < totalAmount) {
      throw new BadRequestException(
        new StandardResponse(true, 'INSUFFICIENT_FUND'),
      );
    }

    // 8) Optional: validate promo code (keeps reference for later consume)
    let promoCode;
    if (promoCodeValue) {
      promoCode = await this.promoCodeService.validatePromoCode(
        promoCodeValue,
        authenticatedUser.id,
      );
    }

    // 9) Persist the order (first real DB write)
    order.Charges = totalCharges;
    order.totalAmount = totalAmount;
    const savedOrder = cart.appliedCouponCode
      ? await this.promoCodeService.saveOrderWithCouponUse(
          order,
          cart.appliedCouponCode,
          authenticatedUser.id,
          cart.storeId,
        )
      : await this.orderService.updateOrder(order);

    // 10) Persist order items (now we have savedOrder.id)
    const orderItems = [];
    for (const cartItem of cart.cartItems) {
      const orderItem = this.orderService.initOrderItems(
        cartItem,
        savedOrder.id,
      );
      await this.orderService.updateOrderItem(orderItem);
      orderItems.push(orderItem);
    }

    savedOrder.orderItems = orderItems;

    // 11) Persist orderCharges and chargeNodes
    const orderCharges = new OrderCharges();
    orderCharges.orderId = savedOrder.id;
    await this.orderService.saveOrderCharges(orderCharges);

    chargeNodes.forEach((node) => {
      node.orderChargesId = orderCharges.id;
    });
    await this.orderService.saveChargesNodes(chargeNodes);

    // 12) Update order charges summary
    await this.orderService.updateOrderCharges(
      totalAmount,
      totalCharges,
      savedOrder.id,
    );

    // 13) Deduct from user's wallet
    userWallet.walletBalance -= Number(totalAmount);
    await this.walletService.updateWallets([userWallet]);

    // 14) Create transactions (user payment and vendor reward)
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
      cart.subtotalBeforeDiscount,
    );
    vendorTransaction.transactionReference = `CATX-${uuidv4()}`;
    vendorTransaction.description = 'ORDER_REWARD';
    vendorTransaction.orderId = savedOrder.id;
    vendorTransaction.category = TransactionCategory.Q_COMMERCE;
    vendorTransaction.status = TransactionStatus.AWAITING_DELIVERY;
    await this.transactionService.createTransaction(vendorTransaction);

    // 15) Initialize order tracking
    await this.orderService.initOrderTracking(savedOrder.id);

    // 16) Delete cart
    await this.cartService.deleteCart();

    // 17) Promo code consume & event (if applicable)
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

    // 18) Send SMS and push notification
    await this.mobileSenderService.sendOrderSmsNotif(
      getStore.mobile,
      authenticatedUser.mobile,
      composeDeliveryAddress(
        selectedDropOffLocation.address,
        savedOrder.recipientInfo?.deliveryAddress ||
          savedOrder.fullHouseAddress,
      ),
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

    // 19) Send email
    const content = {
      customerName:
        authenticatedUser.firstName + ' ' + authenticatedUser.lastName,
      orderDate: new Date().toLocaleDateString(),
      storeName: getStore.name,
      storeAddress: getStore.address.address,
      deliveryFee: savedOrder.Charges,
      isFreeDelivery,
      totalAmount: savedOrder.totalAmount,
      deliveryCode: savedOrder.deliveryCode,
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
        'ogarjunias81@gmail.com',
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

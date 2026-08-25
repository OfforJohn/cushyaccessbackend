import { Stores } from '../../stores/model/stores.entity';
import { StoreMapper } from '../../stores/services/stores.mapper';
import { Cart } from '../model/cart.entity';
import { CartItemResponse, CartResponse } from '../model/dto/cart-response.dto';
import { DeliveryOrderRequest } from '../model/dto/order-request.dto';
import { OrderTypes } from '../model/enum/order-types.enum';
import { OrderUser } from '../model/order-user.entity';
import { Orders } from '../model/order.entity';

export class OrdersMapper {
  public static mapOrderRequestToOrder(
    orderRequestDto: DeliveryOrderRequest,
    authenticatedUserId: string,
    duration: string,
  ): Orders {
    const {
      pickUpLocation,
      dropOffLocation,
      noteForRider,
      noteForVendor,
      recipientInfo,
      senderInfo,
      items,
      totalItems,
    } = orderRequestDto;

    const order = new Orders();
    order.userId = authenticatedUserId;
    order.pickUpLocationAddress = pickUpLocation;
    order.dropOffLocationAddress = dropOffLocation;
    order.type = OrderTypes.logistics;
    order.noteForRider = noteForRider || '';
    order.noteForVendor = noteForVendor || '';
    order.totalItems = items?.length ? items.length : (totalItems ?? 0);
    order.items = items;
    order.duration = duration;
    order.totalAmount = 0;

    // Map recipient info
    const newRecipientInfo = new OrderUser();
    newRecipientInfo.fullName = recipientInfo.fullName;
    newRecipientInfo.emailAddress = recipientInfo.emailAddress;
    newRecipientInfo.phoneNumber = recipientInfo.phoneNumber;
    order.recipientInfo = newRecipientInfo;

    // Map sender info
    const newSenderInfo = new OrderUser();
    newSenderInfo.fullName = senderInfo.fullName;
    newSenderInfo.emailAddress = senderInfo.emailAddress;
    newSenderInfo.phoneNumber = senderInfo.phoneNumber;
    order.senderInfo = newSenderInfo;

    return order;
  }

  mapCartResponse = (cart: Cart, store: Stores, dropOffLocationId?: string) => {
    const cartItemsResponse = cart.cartItems?.map((cartItem) => {
      const cartItemResponse = new CartItemResponse();
      cartItemResponse.id = cartItem.id;
      cartItemResponse.image = cartItem.image;
      cartItemResponse.menuItemId = cartItem.menuItemId;
      cartItemResponse.name = cartItem.name;
      cartItemResponse.price = cartItem.price;
      cartItemResponse.quantity = cartItem.quantity;
      cartItemResponse.selectedOptions = cartItem.selectedOptions || [];

      return cartItemResponse;
    });

    const cartResponse = new CartResponse();
    cartResponse.id = cart.id;
    cartResponse.cartItems = cartItemsResponse;
    cartResponse.vechicleType = cart.vechicleType;
    cartResponse.store = store ? new StoreMapper().mapStoreList(store) : null; // Make sure this cast is valid or map it properly
    cartResponse.totalAmount = cart.totalAmount;
    cartResponse.dropOffLocationId = dropOffLocationId
      ? dropOffLocationId
      : cart.dropOffLocationId;
    cartResponse.pickUpLocationId = cart.pickUpLocationId;
    cartResponse.subtotalBeforeDiscount = Number(
      cart.subtotalBeforeDiscount || 0,
    );
    cartResponse.discountAmount = Number(cart.discountAmount || 0);
    cartResponse.appliedCouponCode = cart.appliedCouponCode || null;

    return cartResponse;
  };
}

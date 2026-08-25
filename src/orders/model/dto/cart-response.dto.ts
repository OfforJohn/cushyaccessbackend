import { StoreList } from '../../../stores/model/dtos/store-list.dto';
import { VehicleType } from '../enum/vechicle-type.enum';

export class CartResponse {
  id: string;

  cartItems: CartItemResponse[];

  pickUpLocationId: string;

  dropOffLocationId: string;

  vechicleType: VehicleType;

  store: StoreList;

  totalAmount: number;

  subtotalBeforeDiscount: number;

  discountAmount: number;

  appliedCouponCode: string | null;
}

export class CartItemResponse {
  id: string;

  menuItemId: string;

  name: string;

  price: number;

  quantity: number;

  image: string;

  selectedOptions: Array<{
    groupId: string;
    groupName: string;
    choices: Array<{
      id: string;
      name: string;
      priceAdjustment: number;
    }>;
  }>;
}

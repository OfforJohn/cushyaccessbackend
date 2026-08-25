import { OrderStatus } from '../enum/order-status.enum';

export class OrderStatusResponseDto {
  orderId: string;
  // vendorName: string;
  numberOfItems: number;
  price: number;
  deliveryAddress: string;
  status: OrderStatus;
  cancellationReason: string;
  dateCreated: Date;
  statusChangedAt: Date;
}

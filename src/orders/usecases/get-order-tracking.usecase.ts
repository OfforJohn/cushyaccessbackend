import { Injectable, NotFoundException } from '@nestjs/common';
import { OrdersService } from '../services/orders.service';
import { StandardResponse } from '../../common/module/standard-response';

@Injectable()
export class GetOrderTrackingUseCase {
  constructor(private readonly ordersService: OrdersService) {}

  async execute(orderId: string, authenticatedUserId?: string) {
    // First check if order exists
    const order = await this.ordersService.findOrderById(
      orderId,
      authenticatedUserId ? ['store', 'rider'] : [],
    );
    if (!order) {
      throw new NotFoundException(
        new StandardResponse(true, 'ORDER_NOT_FOUND'),
      );
    }
    if (authenticatedUserId) {
      await this.ordersService.assertOrderAccess(order, authenticatedUserId);
    }

    // Get order tracking
    const orderTracking =
      await this.ordersService.getOrderTrackingByOrderId(orderId);
    if (!orderTracking) {
      throw new NotFoundException(
        new StandardResponse(true, 'ORDER_TRACKING_NOT_FOUND'),
      );
    }

    return new StandardResponse(false, 'ORDER_TRACKING_FETCHED', {
      ...orderTracking,
      riderId: order.riderId || null,
    });
  }
}

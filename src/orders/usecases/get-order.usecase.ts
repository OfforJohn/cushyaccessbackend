import { BadRequestException, Injectable } from '@nestjs/common';
import { PaginationRequest } from '../../common/module/pagination-request';
import { OrdersService } from '../services/orders.service';
import { StandardResponse } from '../../common/module/standard-response';
import { OrderStatus } from '../model/enum/order-status.enum';

@Injectable()
export class GetOrdersUseCase {
  constructor(private readonly orderService: OrdersService) {}

  private isValidOrderStatus(status: string): status is OrderStatus {
    return Object.values(OrderStatus).includes(status as OrderStatus);
  }

  async execute(paginationRequest: PaginationRequest) {
    if (!paginationRequest.filter) {
      throw new BadRequestException(
        new StandardResponse(true, 'FILTER_IS_REQUIRED'),
      );
    }
    const status = paginationRequest.filter['status'];
    if (!status) {
      throw new BadRequestException(
        new StandardResponse(true, 'STATUS_IS_REQUIRED'),
      );
    }

    if (!this.isValidOrderStatus(status)) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_ORDER_STATUS'),
      );
    }

    const { orders, total } = await this.orderService.getOrdersByStatus(
      status,
      paginationRequest,
    );

    return StandardResponse.withPagination(
      'ORDERS_RETRIEVED_SUCCESSFULLY',
      orders,
      paginationRequest,
      total,
    );
  }
}

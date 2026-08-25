import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OrdersService } from './services/orders.service';
import { CreateDeliveryOrderUseCase } from './usecases/create-delivery-order.usecase';
import { GetOrderTrackingUseCase } from './usecases/get-order-tracking.usecase';
import { GetOrdersUseCase } from './usecases/get-order.usecase';
import { DeliveryOrderRequest } from './model/dto/order-request.dto';
import { PaginationRequest } from '../common/module/pagination-request';
import { CalculateLogisticDeliveryUseCase } from './usecases/calculate-logistic-delivery-charges.usecase';
import { CalculateLogisticsOrderRequest } from './model/dto/calculate-logistics-order-request.dto';
import { Public } from '../auth/service/public.decorator';
import { ApiKeyAuth } from '../api-keys/api-key.decorator';

import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle()
@Controller('api/v1/t/orders')
@Public()
@ApiKeyAuth()
export class ThirdPartyOrderController {
  constructor(
    private readonly orderService: OrdersService,
    private readonly getOrdersUseCase: GetOrdersUseCase,
    private readonly getOrderTrackingUseCase: GetOrderTrackingUseCase,
    private readonly createDeliveryOrderUseCase: CreateDeliveryOrderUseCase,
    private readonly calculateLogisticsDeliveryChargeUseCase: CalculateLogisticDeliveryUseCase,
  ) {}

  @Post('calculate-delivery-charge')
  async calculateDeliveryCharge(
    @Body() calculateLogisticsOrderRequest: CalculateLogisticsOrderRequest,
  ) {
    return this.calculateLogisticsDeliveryChargeUseCase.execute(
      calculateLogisticsOrderRequest.pickUpLocation,
      calculateLogisticsOrderRequest.dropOffLocation,
      calculateLogisticsOrderRequest.vehicleType,
    );
  }

  @Post('create-delivery-order')
  async createDeliveryOrder(
    @Body() deliveryOrderRequestDto: DeliveryOrderRequest,
  ) {
    return this.createDeliveryOrderUseCase.execute(deliveryOrderRequestDto);
  }

  @Get('get-order/:orderId')
  async getOrder(@Param('orderId') orderId: string) {
    return this.orderService.findById(orderId);
  }

  @Get('tracking/:orderId')
  async getOrderTracking(@Param('orderId') orderId: string) {
    return this.getOrderTrackingUseCase.execute(orderId);
  }

  @Get()
  async getOrders(@Query() paginationRequest: PaginationRequest) {
    return this.getOrdersUseCase.execute(paginationRequest);
  }
}

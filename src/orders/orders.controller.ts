import { Controller, Delete, Header, Patch, Put } from '@nestjs/common';
import { Body, Get, Param, Post, Query } from '@nestjs/common';
import { CalculateDeliveryUseCase } from './usecases/calculate-delivery-charges.usecase';
import { CreateDeliveryOrderUseCase } from './usecases/create-delivery-order.usecase';
import { GetOrderTrackingUseCase } from './usecases/get-order-tracking.usecase';
import { GetOrdersUseCase } from './usecases/get-order.usecase';
import { DeliveryOrderRequest } from './model/dto/order-request.dto';
import { PaginationRequest } from '../common/module/pagination-request';
import { CalculateOrderRequest } from './model/dto/calculate-order-request.dto';
import { OrdersService } from './services/orders.service';
import { CreateAIOrderDto, CreateOrderDto } from './model/dto/create-order.dto';
import { CartService } from './services/cart.service';
import { CartItemDto } from './model/dto/cart-item.dto';
import { CreateCartDto } from './model/dto/create-cart.dto';
import { UpdateOrderTrackingDto } from './model/dto/update-order.dto';
import { QCommerceOrderUseCase } from './usecases/q-commerce-order.usecase';
import { OrderTypes } from './model/enum/order-types.enum';
import { AddToCartUseCase } from './usecases/add-to-cart.usecase';
import { StandardResponse } from 'src/common/module/standard-response';
import { UpdateOrderTrackingUseCase } from './usecases/update-order-tracking.usecase';
import { Public } from 'src/auth/service/public.decorator';
import { CalculateLogisticsOrderRequest } from './model/dto/calculate-logistics-order-request.dto';
import { CalculateLogisticDeliveryUseCase } from './usecases/calculate-logistic-delivery-charges.usecase';
import { Permit } from 'src/auth/service/roles.decorator';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { OrderStatus } from './model/enum/order-status.enum';
import { VendorAcceptRejectOrderUseCase } from './usecases/vendor-accept-reject-order.usecase';
import { UserCancelOrderUseCase } from './usecases/user-cancel-order.usecase';
import { AICalculateDeliveryUseCase } from './usecases/calculate-ai-delivery-charges.usecase';
import { SkipThrottle } from '@nestjs/throttler';
import { AICalculateLogisticsOrderRequest } from './model/dto/calculate-ai-logistic-order-request.dto';
import { AIQCommerceOrderUseCase } from './usecases/ai-q-commerce-order.usecase';
import { ValidateOrderCodeUseCase } from './usecases/validate-order-code.usecase';
import { GetActiveDeliveryUseCase } from './usecases/get-active-delivery.usecase';
import { CommonService } from 'src/common/common.service';
import { ReportRiderIssueDto } from './model/dto/report-rider-issue.dto';

@Controller('api/v1/orders')
export class OrdersController {
  constructor(
    private readonly calculateDeliveryUseCase: CalculateDeliveryUseCase,
    private readonly createDeliveryOrderUseCase: CreateDeliveryOrderUseCase,
    private readonly getOrderTrackingUseCase: GetOrderTrackingUseCase,
    private readonly getOrdersUseCase: GetOrdersUseCase,
    private readonly qCommerceOrderUseCase: QCommerceOrderUseCase,
    private readonly orderService: OrdersService,
    private readonly cartService: CartService,
    private readonly addToCartUseCase: AddToCartUseCase,
    private readonly updateOrderUseCase: UpdateOrderTrackingUseCase,
    private readonly calculateLogisticsDeliveryChargeUseCase: CalculateLogisticDeliveryUseCase,
    private readonly updateOrderStatusUseCase: UpdateOrderTrackingUseCase,
    private readonly vendorAcceptRejectOrderUseCase: VendorAcceptRejectOrderUseCase,
    private readonly userCancelOrderUseCase: UserCancelOrderUseCase,
    private readonly aiCalculateDeliveryUseCase: AICalculateDeliveryUseCase,
    private readonly aiQCommerceOrderUseCase: AIQCommerceOrderUseCase,
    private readonly validateOrderCodeUseCase: ValidateOrderCodeUseCase,
    private readonly getActiveDeliveryUseCase: GetActiveDeliveryUseCase,
    private readonly commonService: CommonService,
  ) {}

  @Post('calculate-delivery-charge')
  async calculateDeliveryCharge(
    @Body() calculateOrderRequest: CalculateOrderRequest,
  ) {
    return this.calculateDeliveryUseCase.execute(
      calculateOrderRequest.pickUpLoactionId,
      calculateOrderRequest.dropOffLocationId,
      calculateOrderRequest.vechicleType,
      // TODO: remove condition after mobile update implementation
      calculateOrderRequest.orderType == OrderTypes.q_commerce
        ? OrderTypes.q_commerce
        : OrderTypes.logistics,
    );
  }

  @Post('calculate-delivery-charge-logistics')
  async calculateDeliveryChargeLogistics(
    @Body() calculateLogisticsOrderRequest: CalculateLogisticsOrderRequest,
  ) {
    return this.calculateLogisticsDeliveryChargeUseCase.execute(
      calculateLogisticsOrderRequest.pickUpLocation,
      calculateLogisticsOrderRequest.dropOffLocation,
      calculateLogisticsOrderRequest.vehicleType,
    );
  }

  @Public()
  @SkipThrottle()
  @Post('calculate-ai-delivery-charge')
  async calculateAIDeliveryCharge(
    @Body() calculateLogisticsOrderRequest: AICalculateLogisticsOrderRequest,
  ) {
    return this.aiCalculateDeliveryUseCase.execute(
      calculateLogisticsOrderRequest.pickUpLocation,
      calculateLogisticsOrderRequest.dropOffLocation,
    );
  }

  @Post('init-app-level-charge')
  async initAppCharges() {
    return this.orderService.initAppLevelCharges();
  }

  @Post('create-delivery-order')
  async createDeliveryOrder(
    @Body() deliveryOrderRequestDto: DeliveryOrderRequest,
  ) {
    return this.createDeliveryOrderUseCase.execute(deliveryOrderRequestDto);
  }

  @Post('create-q-commerce-order')
  async placeOrder(@Body() createOrderDto: CreateOrderDto) {
    return this.qCommerceOrderUseCase.execute(createOrderDto);
  }
  @Permit([UserRoles.CUSTOMER])
  @Post('create-ai-q-commerce-order')
  async placeAIOrder(
    @Body() createOrderDto: CreateAIOrderDto,
    @Query('email') email: string,
  ) {
    return this.aiQCommerceOrderUseCase.execute(createOrderDto, email);
  }

  @SkipThrottle()
  @Get('get-order/:orderId')
  async getOrder(@Param('orderId') orderId: string) {
    const user = await this.commonService.getLoggedInUser();
    return this.orderService.findByIdForUser(orderId, user.id);
  }

  @Get('get-all-orders')
  async getAllOrders() {
    return this.orderService.findAll();
  }

  @Permit([UserRoles.CUSTOMER])
  @Get('customer/summary')
  async getCustomerOrderSummary() {
    return this.orderService.getCustomerOrderSummary();
  }

  @Permit([UserRoles.CUSTOMER])
  @Get('customer/recent-items')
  async getRecentOrderItems() {
    return this.orderService.getRecentOrderItems();
  }

  @SkipThrottle()
  @Get('tracking/:orderId')
  async getOrderTracking(@Param('orderId') orderId: string) {
    const user = await this.commonService.getLoggedInUser();
    return this.getOrderTrackingUseCase.execute(orderId, user.id);
  }

  @Put('tracking/:orderId')
  @Permit([UserRoles.ADMIN])
  async updateOrderTracking(
    @Param('orderId') orderId: string,
    @Body() updateOrderTrackingDto: UpdateOrderTrackingDto,
  ) {
    return this.updateOrderUseCase.handle(orderId, updateOrderTrackingDto);
  }

  @Get()
  async getOrders(@Query() paginationRequest: PaginationRequest) {
    return this.getOrdersUseCase.execute(paginationRequest);
  }

  @Post('add-cart')
  async addToCart(@Body() itemData: CartItemDto) {
    return await this.addToCartUseCase.execute(itemData);
  }

  @Delete('remove-cart/:menuItemId')
  async removeFromCart(
    @Param('menuItemId') menuItemId: string,
    @Query('removeCompletely') removeCompletely?: boolean,
  ) {
    return await this.cartService.removeFromCart(menuItemId, removeCompletely);
  }
  @Post('create-cart/:userId')
  async createCart(
    @Param('userId') userId: string,
    @Body() payload: CreateCartDto,
  ) {
    const result = await this.cartService.createCart(userId, payload);
    return new StandardResponse(false, 'CART_CREATED_SUCCESSFULLY', result);
  }
  @Delete('delete-cart')
  async deleteCart() {
    return await this.cartService.deleteCart();
  }
  @Get('get-cart')
  async getCart() {
    return await this.cartService.getCartDetails();
  }
  @Put('update-cart-quantity/:menuItemId')
  async updateCartItemQuantity(
    @Param('menuItemId') menuItemId: string,
    @Query('quantity') quantity: number,
  ) {
    return await this.cartService.updateCartItemQuantity(quantity, menuItemId);
  }
  @Get('get-orders-by-storeId/:storeId')
  async getOrdersByStoreId(@Param('storeId') storeId: string) {
    return await this.orderService.getOrderByStoreId(storeId);
  }
  @Post('update-order-status')
  @Permit([UserRoles.ADMIN])
  async updateOrderStatus(
    @Query('orderId') orderId: string,
    @Body() status: UpdateOrderTrackingDto,
  ) {
    return this.updateOrderStatusUseCase.handle(orderId, status);
  }
  @Patch(':orderId/status')
  @Permit([UserRoles.VENDOR])
  async updateOrderStatusByVendor(
    @Param('orderId') orderId: string,
    @Body('status') status: OrderStatus,
  ) {
    const user = await this.commonService.getLoggedInUser();
    return await this.vendorAcceptRejectOrderUseCase.execute(
      status,
      orderId,
      user.id,
    );
  }
  @Permit([UserRoles.CUSTOMER])
  @Post('user-cancel-order/:id')
  async cancelOrder(@Param('id') orderId: string) {
    return await this.userCancelOrderUseCase.execute(orderId);
  }
  @Permit([UserRoles.CUSTOMER])
  @Post('apply-coupon-to-cart')
  async applyCouponToCart(@Query('code') code: string) {
    return await this.cartService.applyCouponToCart(code);
  }
  @Permit([UserRoles.VENDOR])
  @Post('validate-pickup-code/:orderId')
  async validatePickupCode(
    @Param('orderId') orderId: string,
    @Body('code') bodyCode: string,
    @Query('code') queryCode: string,
  ) {
    const user = await this.commonService.getLoggedInUser();
    // Keep query support for older app builds while new clients avoid placing
    // the secret pickup code in request URLs and access logs.
    return await this.orderService.validatePickupCode(
      orderId,
      bodyCode || queryCode,
      user.id,
    );
  }

  @SkipThrottle()
  @Permit([UserRoles.RIDER])
  @Post('validate-delivery-code/:orderId')
  async validateDeliveryCode(
    @Param('orderId') orderId: string,
    @Query('code') code: string,
  ) {
    const user = await this.commonService.getLoggedInUser();
    return await this.validateOrderCodeUseCase.validateDeliveryCode(
      orderId,
      code,
      user.id,
    );
  }

  @SkipThrottle()
  @Permit([UserRoles.RIDER])
  @Header(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate',
  )
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  @Get('active-delivery')
  async getActiveDelivery() {
    return await this.getActiveDeliveryUseCase.execute();
  }

  @SkipThrottle()
  @Permit([UserRoles.RIDER])
  @Post(':orderId/accept')
  async acceptOrder(@Param('orderId') orderId: string) {
    const user = await this.commonService.getLoggedInUser();
    return await this.orderService.acceptOrder(orderId, user.id);
  }

  @SkipThrottle()
  @Permit([UserRoles.RIDER])
  @Post(':orderId/decline')
  async declineOrder(
    @Param('orderId') orderId: string,
    @Body('reason') reason?: string,
  ) {
    const user = await this.commonService.getLoggedInUser();
    return this.orderService.declineOrderOffer(
      orderId,
      user.id,
      reason?.trim() || 'Rider declined',
    );
  }

  @SkipThrottle()
  @Permit([UserRoles.RIDER])
  @Post(':orderId/in-transit')
  async markOrderInTransit(@Param('orderId') orderId: string) {
    const user = await this.commonService.getLoggedInUser();
    return this.orderService.markInTransit(orderId, user.id);
  }

  @Permit([UserRoles.RIDER])
  @Post(':orderId/issues')
  async reportRiderIssue(
    @Param('orderId') orderId: string,
    @Body() payload: ReportRiderIssueDto,
  ) {
    const user = await this.commonService.getLoggedInUser();
    return this.orderService.reportRiderIssue(orderId, user.id, payload);
  }
}

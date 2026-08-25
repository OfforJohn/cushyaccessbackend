import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Charges } from '../model/app-level/charge-entity';
import { AppLevelCharges } from '../model/app-level/app-level-charges.entity';
import { OrderItems } from '../model/order-items.entity';
import { OrderStatus } from '../model/enum/order-status.enum';
import { OrderTracking } from '../model/order-tracking.entity';
import { Orders } from '../model/order.entity';
import { CommonService } from '../../common/common.service';
import { MenuItemService } from '../../stores/services/menu-item.service';
import { WalletService } from '../../wallet/services/wallet.service';
import { OrderStatusResponseDto } from '../model/dto/order-status-response.dto';
import { PaginationRequest } from '../../common/module/pagination-request';
import { StandardResponse } from '../../common/module/standard-response';
import { UpdateChargeDto } from '../model/dto/update-charge.dto';
import { UpdateAppLevelCharge } from '../model/dto/update-app-level-charge.dto';
import { UserLocationsService } from '../../users/services/user-locations.service';
import { OrderCharges } from '../model/charges/order-charges.entity';
import { ChargeNode } from '../model/charges/charge-node.entity';
import { CartItem } from '../model/cart-items.entity';
import { OrderUser } from '../model/order-user.entity';
import { MailSenderService } from 'src/user-otp/mail-sender.service';
import { TransactionService } from '../../wallet/services/transaction.service';
import { EventBus } from '@nestjs/cqrs';
import axios from 'axios';
import { VehicleType } from '../model/enum/vechicle-type.enum';
import { OrderTypes } from '../model/enum/order-types.enum';
import { Rider, RiderStatus } from 'src/riders/model/rider.entity';
import { RiderService } from 'src/riders/services/riders.service';
import { UsersService } from 'src/users/services/users.service';
import { v4 as uuidv4 } from 'uuid';
import { OrderCreatedEvent, OrderStatusChangedEvent } from 'src/events';
import { RedisCacheService } from 'src/redis-cache/redis-cache.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { calculateRiderCommission } from 'src/riders/rider-commission';
import { MenuItem } from 'src/stores/model/menu-item.entity';
import { assertRiderCanReceiveOrder } from 'src/riders/rider-order-proximity';
import { composeDeliveryAddress } from '../delivery-address';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(AppLevelCharges)
    private readonly appLevelChargesRepository: Repository<AppLevelCharges>,
    @InjectRepository(Charges)
    private readonly chargesRepository: Repository<Charges>,
    @InjectRepository(OrderTracking)
    private readonly orderTrackingRepository: Repository<OrderTracking>,
    @InjectRepository(Orders)
    private readonly ordersRepository: Repository<Orders>,
    private readonly commonService: CommonService,
    private readonly menuItemService: MenuItemService,
    @InjectRepository(OrderItems)
    private readonly orderItemsRepository: Repository<OrderItems>,
    @InjectRepository(OrderCharges)
    private readonly orderChargeRepository: Repository<OrderCharges>,
    @InjectRepository(ChargeNode)
    private readonly chargeNodeRepository: Repository<ChargeNode>,
    private readonly walletService: WalletService,
    private readonly userLocationService: UserLocationsService,
    @InjectRepository(OrderUser)
    private readonly orderUserRepository: Repository<OrderUser>,
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    @Inject(forwardRef(() => RiderService))
    private readonly riderService: RiderService,
    private readonly mailSenderService: MailSenderService,
    private readonly transactionService: TransactionService,
    private readonly usersService: UsersService,
    private readonly eventBus: EventBus,
    private readonly dataSource: DataSource,
    private readonly redisCacheService: RedisCacheService,
    private readonly analyticsService: AnalyticsService,
  ) {}
  private appLevelId = 'sc_cushy_access';

  async initAppLevelCharges() {
    const existingAppLevelCharge = await this.appLevelChargesRepository.findOne(
      {
        where: { id: this.appLevelId },
      },
    );

    if (existingAppLevelCharge) return existingAppLevelCharge;

    const { deliveryFeePerKmForBike, deliveryFeePerKmForVan, charges } =
      Charges.initAppLevelCharges();

    const appLevelCharges = new AppLevelCharges();
    appLevelCharges.id = this.appLevelId;
    appLevelCharges.deliveryFeePerKmForBike = deliveryFeePerKmForBike;
    appLevelCharges.deliveryFeePerKmForVan = deliveryFeePerKmForVan;

    await this.appLevelChargesRepository.save(appLevelCharges);

    for (const chargeData of charges) {
      const charge = new Charges();
      charge.name = chargeData.name;
      charge.chargeType = chargeData.chargeType;
      charge.value = chargeData.value;
      charge.appLevelChargesId = appLevelCharges.id;
      charge.chargeCategory = chargeData.chargeCatgeory;
      charge.appLevelChargesId = appLevelCharges.id;

      await this.chargesRepository.save(charge);
    }

    return appLevelCharges;
  }

  async initOrderTracking(orderId: string) {
    const orderTracking = new OrderTracking();
    orderTracking.orderId = orderId;
    orderTracking.orderStatus = OrderStatus.pending;
    orderTracking.description = '';
    await this.orderTrackingRepository.save(orderTracking);
  }

  async updateOrder(order: Orders) {
    return await this.ordersRepository.save(order);
  }

  async updateOrderCharges(
    totalAmount: number,
    totalCharge: number,
    id: string,
  ) {
    return await this.ordersRepository
      .createQueryBuilder()
      .update(Orders)
      .set({ totalAmount, Charges: totalCharge }) // Use `.set()` to define the fields to update
      .where('id = :id', { id })
      .execute();
  }

  async findOrderById(
    orderId: string,
    relations: string[] = [],
  ): Promise<Orders | null> {
    return await this.ordersRepository.findOne({
      where: { id: orderId },
      relations,
    });
  }

  async getOrderTrackingByOrderId(
    orderId: string,
  ): Promise<OrderTracking | null> {
    return await this.orderTrackingRepository.findOne({
      where: { orderId },
      order: { createdAt: 'DESC' }, // latest first
    });
  }

  async getOrdersByStatus(
    status: OrderStatus,
    paginationRequest: PaginationRequest,
  ): Promise<{ orders: OrderStatusResponseDto[]; total: number }> {
    const authenticatedUser = await this.commonService.getLoggedInUser();

    const qb = this.ordersRepository
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.dropOffLocation', 'dropOffLocation')
      .leftJoinAndSelect('o.recipientInfo', 'recipientInfo')
      .leftJoinAndSelect('o.store', 'store')
      .leftJoinAndSelect('o.orderTracking', 'ot')
      .where('o.userId = :userId', { userId: authenticatedUser.id })
      .andWhere(
        `
        ot.id = (
          SELECT ot2.id 
          FROM "order_tracking" ot2 
          WHERE ot2."orderId" = o.id
          ORDER BY ot2."createdAt" DESC
          LIMIT 1
        )
        `,
      )
      .andWhere('ot.orderStatus = :status', { status })
      .orderBy('o.createdAt', 'DESC')
      .skip((paginationRequest.page - 1) * paginationRequest.size)
      .take(paginationRequest.size);

    const { entities: orders } = await qb.getRawAndEntities();
    const total = await qb.getCount();

    const result = orders.map((order) => {
      const latest = order.orderTracking[0]; // always ONLY the latest

      return {
        orderId: order.id,
        numberOfItems: order.totalItems,
        orderType: order.type,
        price: order.totalAmount,
        deliveryAddress: composeDeliveryAddress(
          order.dropOffLocation?.address || order.dropOffLocationAddress,
          order.recipientInfo?.deliveryAddress || order.fullHouseAddress,
        ),
        status: latest?.orderStatus,
        cancellationReason: latest?.description,
        riderId: order.riderId || null,
        store: {
          id: order.store?.id || '',
          name: order.store?.name || '',
        },
        dateCreated: order.createdAt,
        statusChangedAt: latest?.createdAt || order.updatedAt,
      };
    });

    return { orders: result, total };
  }

  async getCustomerOrderSummary(): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const hasOrders = await this.ordersRepository.exists({
      where: {
        userId: authenticatedUser.id,
        type: OrderTypes.q_commerce,
      },
    });

    return new StandardResponse(
      false,
      'CUSTOMER_ORDER_SUMMARY_FETCHED_SUCCESSFULLY',
      {
        hasOrders,
      },
    );
  }

  async getRecentOrderItems(): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const candidates = await this.orderItemsRepository
      .createQueryBuilder('orderItem')
      .innerJoinAndSelect('orderItem.order', 'order')
      .leftJoinAndSelect('order.store', 'store')
      .innerJoinAndSelect('order.orderTracking', 'latestTracking')
      .leftJoinAndMapOne(
        'orderItem.currentMenuItem',
        MenuItem,
        'currentMenuItem',
        `(currentMenuItem.id = orderItem.menuItemId OR (
          currentMenuItem.storeId = order.storeId
          AND LOWER(currentMenuItem.name) = LOWER(orderItem.name)
        ))`,
      )
      .where('order.userId = :userId', { userId: authenticatedUser.id })
      .andWhere('order.type = :orderType', {
        orderType: OrderTypes.q_commerce,
      })
      .andWhere(
        `
        latestTracking.id = (
          SELECT tracking2.id
          FROM "order_tracking" tracking2
          WHERE tracking2."orderId" = order.id
          ORDER BY tracking2."createdAt" DESC
          LIMIT 1
        )
        `,
      )
      .andWhere('latestTracking.orderStatus = :status', {
        status: OrderStatus.delivered,
      })
      .orderBy('order.createdAt', 'DESC')
      .addOrderBy('orderItem.createdAt', 'ASC')
      // Fetch a small buffer so repeated products can be de-duplicated while
      // still returning five distinct recent items.
      .take(25)
      .getMany();

    const seenItems = new Set<string>();
    const recentItems: Array<Record<string, unknown>> = [];

    for (const orderItem of candidates) {
      const currentMenuItem = (
        orderItem as OrderItems & {
          currentMenuItem?: MenuItem;
        }
      ).currentMenuItem;
      const store = orderItem.order?.store;
      if (!store?.id) continue;

      const menuItemId = currentMenuItem?.id || orderItem.menuItemId;
      const itemKey = menuItemId || `${store.id}:${orderItem.name}`;
      if (seenItems.has(itemKey)) continue;

      seenItems.add(itemKey);
      recentItems.push({
        orderId: orderItem.orderId,
        menuItemId: menuItemId || null,
        name: orderItem.name,
        quantity: orderItem.quantity || 1,
        price: Number(orderItem.price) || 0,
        image: currentMenuItem?.images?.[0] || orderItem.images?.[0] || null,
        isAvailable: currentMenuItem?.isAvailable ?? false,
        store: {
          id: store.id,
          name: store.name,
        },
      });

      if (recentItems.length === 5) break;
    }

    return new StandardResponse(
      false,
      'RECENT_ORDER_ITEMS_FETCHED_SUCCESSFULLY',
      recentItems,
    );
  }

  async getAppLevelCharges(): Promise<AppLevelCharges> {
    const appLevelCharges = await this.appLevelChargesRepository.findOne({
      where: { id: this.appLevelId },
      relations: ['charges'],
    });

    if (!appLevelCharges) {
      throw new NotFoundException(
        new StandardResponse(true, 'APP_LEVEL_CHARGES_NOT_FOUND'),
      );
    }

    return appLevelCharges;
  }

  async updateAppLevelCharges(
    updateApplevelChargeDto: UpdateAppLevelCharge,
  ): Promise<AppLevelCharges> {
    const { deliveryFeePerKmForBike, deliveryFeePerKmForVan } =
      updateApplevelChargeDto;
    const appLevelCharges = await this.appLevelChargesRepository.findOne({
      where: { id: this.appLevelId },
      relations: ['charges'],
    });

    if (!appLevelCharges) {
      throw new NotFoundException(
        new StandardResponse(true, 'APP_LEVEL_CHARGES_NOT_FOUND'),
      );
    }

    appLevelCharges.deliveryFeePerKmForBike = deliveryFeePerKmForBike;
    appLevelCharges.deliveryFeePerKmForVan = deliveryFeePerKmForVan;

    await this.appLevelChargesRepository.save(appLevelCharges);
    return await this.getAppLevelCharges();
  }

  async updateCharge(id: string, updateChargeDto: UpdateChargeDto) {
    const chargeExists = await this.chargesRepository.exists({
      where: { id },
    });

    if (!chargeExists) {
      throw new BadRequestException(
        new StandardResponse(true, 'CHARGE_NOT_FOUND'),
      );
    }

    const { name, value, chargeType } = updateChargeDto;

    await this.chargesRepository.update({ id }, { name, value, chargeType });
  }

  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in kilometers

    return Math.round(distance * 100) / 100; // Round to 2 decimal places
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  async calculateDeliveryDistance(
    pickUpLocationId: string,
    dropOffLocationId: string,
  ): Promise<{ distanceInKm: number; duration: string }> {
    const [pickUpLocation, dropOffLocation] = await Promise.all([
      this.userLocationService.getLocationById(pickUpLocationId),
      this.userLocationService.getLocationById(dropOffLocationId),
    ]);

    if (!pickUpLocation || !dropOffLocation) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_LOCATIONS'),
      );
    }

    return this.calculateLogisticDeliveryDistance(
      pickUpLocation.address,
      dropOffLocation.address,
    );
  }

  getLocationById(locationId: string) {
    return this.userLocationService.getLocationById(locationId);
  }
  async calculateLogisticDeliveryDistance(
    pickUpLocation: string,
    dropOffLocation: string,
  ): Promise<{ distanceInKm: number; duration: string }> {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json`;

    const response = await axios.get(url, {
      params: {
        origins: pickUpLocation,
        destinations: dropOffLocation,
        key: apiKey,
        units: 'metric',
      },
    });

    const data = response.data;

    if (data.status !== 'OK' || data.rows[0].elements[0].status !== 'OK') {
      throw new BadRequestException(
        new StandardResponse(true, 'UNABLE_TO_CALCULATE_DISTANCE'),
      );
    }

    const distanceInMeters = data.rows[0].elements[0].distance.value;
    const duration = data.rows[0].elements[0].duration.text;
    const distanceInKm = distanceInMeters / 1000;
    return { distanceInKm, duration };
  }

  async saveOrderCharges(orderCharges: OrderCharges): Promise<OrderCharges> {
    return await this.orderChargeRepository.save(orderCharges);
  }

  async saveChargesNodes(chargeNodes: ChargeNode[]): Promise<ChargeNode[]> {
    return await this.chargeNodeRepository.save(chargeNodes);
  }
  async findAll() {
    const orders = await this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.orderItems', 'orderItems')
      .leftJoinAndSelect('order.orderTracking', 'orderTracking')
      .leftJoinAndSelect('order.store', 'store')
      .leftJoinAndSelect('order.pickUpLocation', 'pickUpLocation')
      .leftJoinAndSelect('order.dropOffLocation', 'dropOffLocation')
      .leftJoinAndSelect('order.recipientInfo', 'recipientInfo')
      .leftJoinAndSelect('order.orderCharges', 'orderCharges')
      .leftJoinAndSelect('orderCharges.chargeNodes', 'chargeNodes')
      .orderBy('order.createdAt', 'DESC')
      .getMany();

    return orders;
  }

  async findById(id: string) {
    const order = await this.ordersRepository.findOne({
      where: { id },
      relations: [
        'orderItems',
        'store',
        'user',
        'pickUpLocation',
        'dropOffLocation',
        'senderInfo',
        'recipientInfo',
        'rider',
        'rider.user',
        'orderCharges',
        'orderCharges.chargeNodes',
      ],
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return new StandardResponse(
      false,
      'ORDER_FETCHED_SUCCESSFULLY',
      this.mapToOrderResponse(order),
    );
  }

  async findByIdForUser(id: string, userId: string) {
    const order = await this.ordersRepository.findOne({
      where: { id },
      relations: [
        'orderItems',
        'store',
        'user',
        'pickUpLocation',
        'dropOffLocation',
        'senderInfo',
        'recipientInfo',
        'rider',
        'rider.user',
        'orderCharges',
        'orderCharges.chargeNodes',
      ],
    });
    if (!order) throw new NotFoundException('Order not found');
    await this.assertOrderAccess(order, userId);

    return new StandardResponse(
      false,
      'ORDER_FETCHED_SUCCESSFULLY',
      this.mapToOrderResponse(order),
    );
  }

  async assertOrderAccess(order: Orders, userId: string) {
    if (
      order.userId === userId ||
      order.store?.userId === userId ||
      order.rider?.userId === userId
    ) {
      return;
    }
    if (await this.usersService.isAdmin(userId)) return;
    throw new ForbiddenException('You cannot view this order');
  }

  initOrderItems(cartItem: CartItem, orderId: string) {
    return this.orderItemsRepository.create({
      menuItemId: cartItem.menuItemId,
      name: cartItem.name,
      price: cartItem.price,
      quantity: cartItem.quantity,
      selectedOptions: cartItem.selectedOptions || [],
      orderId,
      storeId: cartItem.storeId,
      images: cartItem.image ? [cartItem.image] : [],
    });
  }

  updateOrderItem(orderItem: OrderItems) {
    return this.orderItemsRepository.save(orderItem);
  }

  initOrderUser({
    name,
    email,
    number,
    address,
    addressId,
  }: {
    name: string;
    email: string;
    number: string;
    address: string;
    addressId: string;
  }) {
    const orderUser = this.orderUserRepository.create({
      fullName: name,
      phoneNumber: number,
      emailAddress: email,
      deliveryAddress: address,
      locationId: addressId,
    });

    return this.orderUserRepository.save(orderUser);
  }

  updateOrderUser(orderUser: OrderUser) {
    return this.orderUserRepository.save(orderUser);
  }
  async getOrderByStoreId(storeId: string) {
    const queryBuilder = this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.orderTracking', 'orderTracking')
      .leftJoinAndSelect('order.store', 'store')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.orderItems', 'orderItems')
      .leftJoinAndSelect('order.dropOffLocation', 'dropOffLocation')
      .leftJoinAndSelect('order.pickUpLocation', 'pickUpLocation')
      .where('store.id = :storeId', { storeId })
      .orderBy('order.createdAt', 'DESC');

    const orders = await queryBuilder.getManyAndCount();

    const message = 'ORDERS_FETCHED_SUCCESSFULLY';
    return new StandardResponse(false, message, {
      orders,
    });
  }

  async computeLogisticsCalculation(
    pickUpLocation: string,
    dropOffLocation: string,
    vehicleType: VehicleType,
    orderType: OrderTypes = OrderTypes.logistics,
  ) {
    const { distanceInKm, duration } =
      await this.calculateLogisticDeliveryDistance(
        pickUpLocation,
        dropOffLocation,
      );

    // Get app level charges
    const appLevelCharges = await this.getAppLevelCharges();

    const vehicleDeliveryFee =
      vehicleType == VehicleType.bike
        ? appLevelCharges.deliveryFeePerKmForBike
        : appLevelCharges.deliveryFeePerKmForVan;
    // Calculate delivery fee based on distance
    const deliveryFee = Number(
      (distanceInKm * (vehicleDeliveryFee + 1)).toFixed(2),
    );
    let totalCharges = deliveryFee;

    const chargeNodes: ChargeNode[] = [];
    const deliveryFeeChargeNode = new ChargeNode();
    deliveryFeeChargeNode.amount = deliveryFee;
    deliveryFeeChargeNode.name = 'deliveryFee';
    chargeNodes.push(deliveryFeeChargeNode);

    appLevelCharges.charges?.forEach((charge) => {
      if (charge.name === 'qCommerceServiceCharge') {
        return;
      }
      if (charge.chargeCategory == orderType) {
        totalCharges += charge.value;
        const chargeNode = new ChargeNode();
        chargeNode.amount = charge.value;
        chargeNode.name = charge.name;
        chargeNodes.push(chargeNode);
      }
    });
    return {
      distanceInKm,
      duration,
      totalCharges: Number(Number(totalCharges).toFixed(2)),
      chargeNodes,
      deliveryFee,
    };
  }

  // ============================================================
  // GET AVAILABLE ORDERS FOR RIDER
  // ============================================================

  /**
   * Get available orders for a specific rider
   *
   * @description
   * Returns orders that are:
   * - Pending status (not yet accepted by any rider)
   * - Not assigned to any rider
   * - Not scheduled for future delivery
   * - Filtered by rider preferences (distance, order type, min amount)
   *
   * @param riderId - The ID of the rider
   * @param filters - Optional filters (maxDistance, orderTypes, minAmount)
   * @param limit - Number of orders to return
   * @param page - Page number for pagination
   * @returns Array of available orders
   */
  async getAvailableOrdersForRider(
    riderId: string,
    filters?: {
      maxDistance?: number;
      orderTypes?: OrderTypes[];
      minAmount?: number;
      excludeOrderIds?: string[];
    },
    limit: number = 50,
    page: number = 1,
  ): Promise<any[]> {
    try {
      const repo =
        this.ordersRepository || this.dataSource.getRepository(Orders);
      const queryBuilder = repo
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.store', 'store')
        .leftJoinAndSelect('order.orderItems', 'orderItems')
        .leftJoinAndSelect('order.pickUpLocation', 'pickUpLocation')
        .leftJoinAndSelect('order.dropOffLocation', 'dropOffLocation')
        .leftJoinAndSelect('order.senderInfo', 'senderInfo')
        .leftJoinAndSelect('order.recipientInfo', 'recipientInfo')
        .leftJoinAndSelect('order.orderTracking', 'ot')
        .where('order.riderId IS NULL')
        .andWhere('order.scheduleDelivery = :scheduled', { scheduled: false })
        .andWhere(
          `(SELECT ot."orderStatus" FROM "order_tracking" ot WHERE ot."orderId" = "order"."id" ORDER BY ot."createdAt" DESC LIMIT 1) = :ackStatus`,
          { ackStatus: OrderStatus.acknoledged },
        )
        .orderBy('order.createdAt', 'ASC');

      // Apply filters
      if (filters?.orderTypes && filters.orderTypes.length > 0) {
        queryBuilder.andWhere('order.type IN (:...orderTypes)', {
          orderTypes: filters.orderTypes,
        });
      }

      if (filters?.minAmount) {
        queryBuilder.andWhere('order.totalAmount >= :minAmount', {
          minAmount: filters.minAmount,
        });
      }

      if (filters?.excludeOrderIds && filters.excludeOrderIds.length > 0) {
        queryBuilder.andWhere('order.id NOT IN (:...excludeOrderIds)', {
          excludeOrderIds: filters.excludeOrderIds,
        });
      }

      // If rider has location and maxDistance, filter by distance
      // DISABLED FOR NOW: I don't want the orders to be filtered by the rider's location for now
      /*
      if (rider?.currentLatitude && rider?.currentLongitude && filters?.maxDistance) {
        // Using PostGIS for distance filtering
        // Assumes dropOffLocation has latitude/longitude columns
        queryBuilder.andWhere(
          `ST_DWithin(
            ST_MakePoint(:longitude, :latitude)::geography,
            ST_MakePoint(
              COALESCE(order."dropOffLocationLongitude", order."dropOffLocation"."longitude"),
              COALESCE(order."dropOffLocationLatitude", order."dropOffLocation"."latitude")
            )::geography,
            :maxDistance
          )`,
          {
            latitude: rider.currentLatitude,
            longitude: rider.currentLongitude,
            maxDistance: filters.maxDistance * 1000, // km to meters
          }
        );
      }
      */

      // Pagination
      const skip = (page - 1) * limit;
      queryBuilder.skip(skip).take(limit);

      const orders = await queryBuilder.getMany();
      return orders.map((order) => this.mapToOrderResponse(order));
    } catch (error) {
      console.error('Get available orders error:', error);
      return [];
    }
  }

  // ============================================================
  // GET LIVE ORDERS (with filters)
  // ============================================================

  /**
   * Get live orders with filtering
   *
   * @description
   * Returns orders with real-time status. Can be filtered by:
   * - Rider ID (orders assigned to a specific rider)
   * - Store ID (orders from a specific store)
   * - Status (pending, accepted, picked_up, etc.)
   * - Order type (q_commerce, delivery, etc.)
   *
   * @param userId - The ID of the requesting user
   * @param query - Query parameters for filtering
   * @returns Paginated orders with summary stats
   */
  async getLiveOrders(
    userId: string,
    query: {
      riderId?: string;
      storeId?: string;
      status?: OrderStatus;
      orderType?: string;
      readyForPickup?: boolean;
      scheduledOnly?: boolean;
      limit?: number;
      page?: number;
    },
  ): Promise<{
    orders: any[];
    total: number;
    page: number;
    totalPages: number;
    limit: number;
    summary: any;
  }> {
    const {
      riderId,
      storeId,
      status,
      orderType,
      readyForPickup,
      scheduledOnly,
      limit = 50,
      page = 1,
    } = query;

    // Check if user is a rider
    const rider = await this.riderService.findByUserId(userId);
    const isRider = !!rider;

    const queryBuilder = this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.store', 'store')
      .leftJoinAndSelect('order.orderItems', 'orderItems')
      .leftJoinAndSelect('order.pickUpLocation', 'pickUpLocation')
      .leftJoinAndSelect('order.dropOffLocation', 'dropOffLocation')
      .leftJoinAndSelect('order.senderInfo', 'senderInfo')
      .leftJoinAndSelect('order.recipientInfo', 'recipientInfo')
      .leftJoinAndSelect('order.orderCharges', 'orderCharges')
      .leftJoinAndSelect('order.user', 'user')
      .orderBy('order.createdAt', 'DESC');

    // Filter by rider
    if (riderId) {
      queryBuilder.andWhere(
        '(order.riderId = :riderId OR (order.status IN (:...availableStatuses) AND order.riderId IS NULL))',
        {
          riderId,
          availableStatuses: [OrderStatus.pending],
        },
      );
    } else if (isRider) {
      // If user is a rider, show their assigned orders
      const rider = await this.riderService.findByUserId(userId);
      if (rider) {
        queryBuilder.andWhere('order.riderId = :riderId', {
          riderId: rider.id,
        });
      }
    }

    // Filter by store
    if (storeId) {
      queryBuilder.andWhere('order.storeId = :storeId', { storeId });
    }

    // Filter by status
    if (status) {
      queryBuilder.andWhere('order.status = :status', { status });
    } else if (isRider) {
      // For riders, show active orders by default
      queryBuilder.andWhere('order.status IN (:...activeStatuses)', {
        activeStatuses: [
          OrderStatus.pending,
          OrderStatus.acknoledged,
          OrderStatus.picked_up,
          OrderStatus.in_transit,
        ],
      });
    }

    // Filter by order type
    if (orderType) {
      queryBuilder.andWhere('order.type = :orderType', { orderType });
    }

    // Ready for pickup filter
    if (readyForPickup) {
      queryBuilder.andWhere('order.status IN (:...pickupStatuses)', {
        pickupStatuses: [OrderStatus.picked_up, OrderStatus.in_transit],
      });
    }

    // Scheduled only
    if (scheduledOnly) {
      queryBuilder.andWhere('order.scheduleDelivery = :scheduled', {
        scheduled: true,
      });
    }

    // Pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    // Execute query
    const [orders, total] = await queryBuilder.getManyAndCount();

    // Transform to response
    const orderResponses = orders.map((order) =>
      this.mapToOrderResponse(order),
    );

    // Get summary stats
    const summary = await this.getOrderSummary(query);

    const totalPages = Math.ceil(total / limit);

    return {
      orders: orderResponses,
      total,
      page,
      totalPages,
      limit,
      summary,
    };
  }

  /**
   * Cancel an order
   *
   * @param orderId - The ID of the order
   * @param userId - The ID of the user cancelling
   * @param reason - Reason for cancellation
   * @returns The updated order
   */
  async cancelOrder(
    orderId: string,
    userId: string,
    reason?: string,
  ): Promise<any> {
    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
      relations: ['user'],
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Check permissions: user can cancel their own order, admin can cancel any
    const isAdmin = await this.usersService.isAdmin(userId);
    if (!isAdmin && order.userId !== userId) {
      throw new ForbiddenException('You cannot cancel this order');
    }

    // Check if order can be cancelled
    const cancellableStatuses = [OrderStatus.pending, OrderStatus.acknoledged];
    if (!cancellableStatuses.includes(order.status)) {
      throw new BadRequestException(
        `Order cannot be cancelled (status: ${order.status})`,
      );
    }

    const previousStatus = order.status;
    order.status = OrderStatus.cancelled;
    order.cancelledAt = new Date();
    order.rejectionReason = reason || 'Order cancelled by user';

    await this.ordersRepository.save(order);

    // If order was assigned to a rider, free the rider
    if (order.riderId) {
      // Notify rider that order was cancelled
      // This will be handled by the gateway
    }

    // Emit event
    this.eventBus.publish(
      new OrderStatusChangedEvent(
        order.id,
        previousStatus,
        OrderStatus.cancelled,
        userId,
      ),
    );

    return this.mapToOrderResponse(order);
  }

  /**
   * Reject an order (rider declines)
   *
   * @param orderId - The ID of the order
   * @param userId - The ID of the rider
   * @param reason - Reason for rejection
   * @returns The updated order
   */
  async rejectOrder(
    orderId: string,
    userId: string,
    reason: string,
  ): Promise<any> {
    const rider = await this.riderService.findByUserId(userId);
    if (!rider) {
      throw new ForbiddenException('Only riders can reject orders');
    }

    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status !== OrderStatus.pending) {
      throw new BadRequestException('Order is no longer available');
    }

    order.status = OrderStatus.rejected;
    order.rejectedAt = new Date();
    order.rejectionReason = reason;

    await this.ordersRepository.save(order);

    // Emit event
    this.eventBus.publish(
      new OrderStatusChangedEvent(
        order.id,
        OrderStatus.pending,
        OrderStatus.rejected,
        userId,
      ),
    );

    return this.mapToOrderResponse(order);
  }

  // ============================================================
  // ORDER SUMMARY / STATS
  // ============================================================

  /**
   * Get order summary by status
   *
   * @param query - Query parameters for filtering
   * @returns Summary counts by status
   */
  async getOrderSummary(query: {
    storeId?: string;
    riderId?: string;
    dateRange?: { start: Date; end: Date };
  }): Promise<any> {
    const { storeId, riderId, dateRange } = query;

    const queryBuilder = this.ordersRepository
      .createQueryBuilder('order')
      .select('order.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('order.status');

    if (storeId) {
      queryBuilder.andWhere('order.storeId = :storeId', { storeId });
    }

    if (riderId) {
      queryBuilder.andWhere('order.riderId = :riderId', { riderId });
    }

    if (dateRange) {
      queryBuilder.andWhere('order.createdAt BETWEEN :start AND :end', {
        start: dateRange.start,
        end: dateRange.end,
      });
    }

    const results = await queryBuilder.getRawMany();

    const summary = {
      pending: 0,
      accepted: 0,
      picked_up: 0,
      in_transit: 0,
      delivered: 0,
      cancelled: 0,
      rejected: 0,
    };

    results.forEach((item) => {
      const status = item.status as OrderStatus;
      const count = parseInt(item.count);
      if (status in summary) {
        summary[status] = count;
      }
    });

    return summary;
  }

  /**
   * Get rider order statistics
   *
   * @param riderId - The ID of the rider
   * @param dateRange - Optional date range
   * @returns Rider order stats
   */
  async getRiderOrderStats(
    riderId: string,
    dateRange?: { start: Date; end: Date },
  ): Promise<any> {
    const queryBuilder = this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.orderCharges', 'orderCharges')
      .leftJoinAndSelect('orderCharges.chargeNodes', 'chargeNodes')
      .where('order.riderId = :riderId', { riderId });

    if (dateRange) {
      queryBuilder.andWhere('order.createdAt BETWEEN :start AND :end', {
        start: dateRange.start,
        end: dateRange.end,
      });
    }

    const orders = await queryBuilder.getMany();

    const totalOrders = orders.length;
    const completedOrders = orders.filter(
      (o) => o.status === OrderStatus.delivered,
    ).length;
    const cancelledOrders = orders.filter(
      (o) => o.status === OrderStatus.cancelled,
    ).length;
    const rejectedOrders = orders.filter(
      (o) => o.status === OrderStatus.rejected,
    ).length;

    const totalEarnings = orders
      .filter((o) => o.status === OrderStatus.delivered)
      .reduce((sum, order) => {
        const deliveryFee = Number(
          order.orderCharges?.chargeNodes?.find(
            (node) => node.name === 'deliveryFee',
          )?.amount || 0,
        );
        return sum + calculateRiderCommission(deliveryFee).netRiderPayout;
      }, 0);

    const avgOrderValue =
      completedOrders > 0 ? totalEarnings / completedOrders : 0;

    return {
      totalOrders,
      completedOrders,
      cancelledOrders,
      rejectedOrders,
      completionRate:
        totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0,
      totalEarnings,
      avgOrderValue,
    };
  }

  // ============================================================
  // GET SINGLE ORDER
  // ============================================================

  /**
   * Get a single order by ID
   *
   * @param orderId - The ID of the order
   * @param userId - The ID of the requesting user (for permission check)
   * @returns The order details
   */
  async getOrderById(orderId: string, userId: string): Promise<any> {
    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
      relations: [
        'store',
        'orderItems',
        'pickUpLocation',
        'dropOffLocation',
        'senderInfo',
        'recipientInfo',
        'orderCharges',
        'user',
        'rider',
        'rider.user',
      ],
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Check permissions: user can view their own order
    const isAdmin = await this.usersService.isAdmin(userId);
    const isRider =
      order.riderId && (await this.riderService.findByUserId(userId));

    if (
      !isAdmin &&
      order.userId !== userId &&
      (!isRider || order.riderId !== (isRider as any)?.id)
    ) {
      throw new ForbiddenException('You cannot view this order');
    }

    return this.mapToOrderResponse(order);
  }

  // ============================================================
  // ASSIGN RIDER TO ORDER (Admin)
  // ============================================================

  /**
   * Assign a specific rider to an order (admin only)
   *
   * @param orderId - The ID of the order
   * @param riderId - The ID of the rider to assign
   * @param adminId - The ID of the admin making the assignment
   * @returns The updated order
   */
  async assignRiderToOrder(
    orderId: string,
    riderId: string,
    adminId: string,
  ): Promise<any> {
    // Check if admin
    const isAdmin = await this.usersService.isAdmin(adminId);
    if (!isAdmin) {
      throw new ForbiddenException('Only admins can assign riders');
    }

    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status !== OrderStatus.pending) {
      throw new BadRequestException(
        `Cannot assign rider to order with status: ${order.status}`,
      );
    }

    const rider = await this.riderRepository.findOne({
      where: { id: riderId, status: RiderStatus.ACTIVE },
    });

    if (!rider) {
      throw new NotFoundException('Rider not found or not active');
    }

    order.riderId = rider.id;
    order.riderAssignedAt = new Date();
    order.status = OrderStatus.acknoledged;

    await this.ordersRepository.save(order);

    // Emit event
    this.eventBus.publish(
      new OrderStatusChangedEvent(
        order.id,
        OrderStatus.pending,
        OrderStatus.acknoledged,
        adminId,
      ),
    );

    return this.mapToOrderResponse(order);
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================

  /**
   * Map Order entity to response DTO
   */
  private mapToOrderResponse(order: Orders): any {
    let deliveryFee = 0;
    let serviceFee = 0;
    let totalCharges = 0;

    if (
      order.orderCharges?.chargeNodes &&
      order.orderCharges.chargeNodes.length > 0
    ) {
      order.orderCharges.chargeNodes.forEach((node) => {
        const amount = Number(node.amount) || 0;
        totalCharges += amount;

        if (node.name === 'deliveryFee') {
          deliveryFee = amount;
        } else if (
          node.name === 'serviceFee' ||
          node.name === 'qCommerceServiceCharge'
        ) {
          serviceFee = amount;
        }
      });
    }
    const commission = calculateRiderCommission(deliveryFee);
    const selectedDropOffAddress =
      order.dropOffLocation?.address || order.dropOffLocationAddress;
    const addressDetails =
      order.recipientInfo?.deliveryAddress || order.fullHouseAddress;
    const deliveryAddress = composeDeliveryAddress(
      selectedDropOffAddress,
      addressDetails,
    );
    return {
      id: order.id,
      status: order.status,
      type: order.type,
      storeId: order.storeId,
      storeName: order.store?.name || order.storeId,
      userId: order.userId,
      customerName: order.user
        ? `${order.user.firstName} ${order.user.lastName}`
        : null,
      customerPhone: order.user?.mobile || null,
      totalItems: order.totalItems,
      totalAmount: Number(order.totalAmount) || 0,
      subtotal: Number(order.totalAmountBeforeCharges) || 0,
      deliveryFee: deliveryFee,
      riderPayout: commission.netRiderPayout,
      riderCommission: commission.platformCommission,
      riderCommissionRate: commission.platformCommissionRate,
      serviceFee: serviceFee,
      totalCharges: totalCharges,
      discountAmount: Number(order.discountAmount) || 0,
      pickupCode: order.pickupCode,
      deliveryCode: order.deliveryCode,
      pickUpLocation: {
        address: order.pickUpLocationAddress || order.pickUpLocation?.address,
        latitude: order.pickUpLocation?.latitude,
        longitude: order.pickUpLocation?.longitude,
      },
      dropOffLocation: {
        address: deliveryAddress,
        selectedAddress: selectedDropOffAddress,
        addressDetails,
        latitude: order.dropOffLocation?.latitude,
        longitude: order.dropOffLocation?.longitude,
      },
      dropOffLocationAddress: selectedDropOffAddress,
      fullHouseAddress: order.fullHouseAddress,
      deliveryAddress,
      noteForRider: order.noteForRider,
      noteForVendor: order.noteForVendor,
      noteForStore: order.noteForStore,
      senderInfo: {
        fullName: order.senderInfo?.fullName,
        phoneNumber: order.senderInfo?.phoneNumber,
      },
      recipientInfo: {
        fullName: order.recipientInfo?.fullName,
        phoneNumber: order.recipientInfo?.phoneNumber,
        deliveryAddress: order.recipientInfo?.deliveryAddress,
      },
      items:
        order.orderItems?.map((item) => ({
          id: item.id,
          menuItemId: item.menuItemId,
          name: item.name || 'Item',
          quantity: item.quantity || 1,
          unitPrice: Number(item.price) || 0,
          totalPrice: Number(item.price * item.quantity) || 0,
          image: item.images?.[0] || null,
          selectedOptions: item.selectedOptions || [],
        })) || [],
      riderId: order.riderId,
      rider: order.rider
        ? {
            id: order.rider.id,
            userId: order.rider.userId,
            name: order.rider.user
              ? `${order.rider.user.firstName || ''} ${order.rider.user.lastName || ''}`.trim()
              : 'Assigned Rider',
            phone: order.rider.user?.mobile || '',
            bikeType: order.rider.bikeType || null,
            bikeColor: order.rider.bikeColor || null,
            licensePlate: order.rider.licensePlate || null,
            rating: Number(order.rider.rating) || 0,
            totalDeliveries: order.rider.totalDeliveries || 0,
          }
        : null,
      isPaidOut: order.isPaidOut,
      scheduleDelivery: order.scheduleDelivery,
      scheduleDeliveryDate: order.scheduleDeliveryDate?.toISOString(),
      scheduleDeliveryTime: order.scheduleDeliveryTime,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      acceptedAt: order.riderAcceptedAt?.toISOString(),
      pickedUpAt: order.pickedUpAt?.toISOString(),
      deliveredAt: order.deliveredAt?.toISOString(),
      cancelledAt: order.cancelledAt?.toISOString(),
      rejectedAt: order.rejectedAt?.toISOString(),
    };
  }

  // ============================================================
  // CREATE ORDER (for testing / admin)
  // ============================================================

  /**
   * Create a new order
   *
   * @param data - Order data
   * @param userId - The ID of the user creating the order
   * @returns The created order
   */
  async createOrder(data: any, userId: string): Promise<any> {
    return await this.dataSource.transaction(async (manager) => {
      // Create sender info
      const senderInfo = manager.create(OrderUser, {
        fullName: data.senderName || 'Unknown',
        phoneNumber: data.senderPhone || '',
      });
      await manager.save(senderInfo);

      // Create recipient info
      const recipientInfo = manager.create(OrderUser, {
        fullName: data.recipientName || 'Recipient',
        phoneNumber: data.recipientPhone || '',
      });
      await manager.save(recipientInfo);

      // Create order
      const order = manager.create(Orders, {
        userId,
        type: data.type || OrderTypes.q_commerce,
        pickUpLocationAddress: data.pickUpAddress,
        dropOffLocationAddress: data.dropOffAddress,
        noteForRider: data.noteForRider,
        noteForVendor: data.noteForVendor,
        totalItems: data.items?.length || 0,
        totalAmount: data.totalAmount || 0,
        totalAmountBeforeCharges:
          data.totalAmountBeforeCharges || data.totalAmount || 0,
        discountAmount: data.discountAmount || 0,
        appliedCouponCode: data.couponCode,
        storeId: data.storeId,
        scheduleDelivery: data.scheduleDelivery || false,
        scheduleDeliveryDate: data.scheduleDeliveryDate,
        scheduleDeliveryTime: data.scheduleDeliveryTime,
        senderInfo,
        recipientInfo,
        status: OrderStatus.pending,
        isPaidOut: false,
        items: data.items?.map((item: any) => item.id) || [],
      });
      await manager.save(order);

      // Create order items
      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          const orderItem = manager.create(OrderItems, {
            orderId: order.id,
            productName: item.name,
            quantity: item.quantity || 1,
            price: item.price || 0,
            totalPrice: (item.quantity || 1) * (item.price || 0),
          });
          await manager.save(orderItem);
        }
      }

      // Create order charges
      if (data.deliveryFee !== undefined || data.serviceFee !== undefined) {
        const charges = manager.create(OrderCharges, {
          orderId: order.id,
          deliveryFee: data.deliveryFee || 0,
          serviceFee: data.serviceFee || 0,
        });
        await manager.save(charges);
      }

      // Emit event
      this.eventBus.publish(new OrderCreatedEvent(order.id, userId));

      return this.mapToOrderResponse(order);
    });
  }

  // src/orders/services/order.service.ts

  // Add these methods to your OrderService

  /**
   * Add a tracking entry when order status changes
   */
  async addOrderTracking(
    orderId: string,
    orderStatus: OrderStatus,
    description?: string,
  ): Promise<OrderTracking> {
    const tracking = this.orderTrackingRepository.create({
      id: `otk_${uuidv4()}`,
      orderId,
      orderStatus,
      description: description || `Order status changed to ${orderStatus}`,
    });

    return await this.orderTrackingRepository.save(tracking);
  }

  /**
   * Update order status with tracking
   */
  async updateOrderStatus(
    orderId: string,
    newStatus: OrderStatus,
    description?: string,
  ): Promise<Orders> {
    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const oldStatus = order.status;
    order.status = newStatus;
    await this.ordersRepository.save(order);

    // Add tracking entry
    await this.addOrderTracking(
      orderId,
      newStatus,
      description || `Status changed from ${oldStatus} to ${newStatus}`,
    );

    // Emit event
    this.eventBus.publish(
      new OrderStatusChangedEvent(orderId, oldStatus, newStatus, order.userId),
    );

    return order;
  }

  /**
   * Accept an order with tracking
   */
  async acceptOrder(orderId: string, userId: string): Promise<any> {
    const rider = await this.riderService.findByUserId(userId);
    if (!rider) {
      throw new ForbiddenException('Only riders can accept orders');
    }

    const acceptedAt = new Date();
    let assignmentChanged = false;
    let previousOrderStatus = OrderStatus.pending;
    await this.dataSource.transaction(async (manager) => {
      // Serialize all acceptance attempts by this rider. Without this lock,
      // two offers for different orders can both observe "no active job" and
      // be accepted at the same time.
      const lockedRider = await manager.findOne(Rider, {
        where: { id: rider.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedRider) throw new ForbiddenException('Rider account not found');
      if (lockedRider.status !== RiderStatus.ACTIVE) {
        throw new BadRequestException('Your rider account is not active');
      }
      if (
        !lockedRider.trainingCompleted ||
        lockedRider.backgroundCheckStatus !== 'approved'
      ) {
        throw new BadRequestException('Your rider clearance is incomplete');
      }
      if (!lockedRider.isOnline) {
        throw new BadRequestException('You must be online to accept orders');
      }

      const lockedOrder = await manager.findOne(Orders, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedOrder) throw new NotFoundException('Order not found');

      // A response-lost retry by the winning rider is successful and does not
      // append duplicate tracking entries.
      if (
        lockedOrder.riderId === lockedRider.id &&
        lockedOrder.status === OrderStatus.acknoledged
      ) {
        return;
      }
      if (lockedOrder.riderId) {
        throw new BadRequestException('Order has already been taken');
      }
      if (
        ![OrderStatus.pending, OrderStatus.acknoledged].includes(
          lockedOrder.status,
        )
      ) {
        throw new BadRequestException(
          `Order is not available (status: ${lockedOrder.status})`,
        );
      }

      const latestTracking = await manager.findOne(OrderTracking, {
        where: { orderId },
        order: { createdAt: 'DESC' },
      });
      if (latestTracking?.orderStatus !== OrderStatus.acknoledged) {
        throw new BadRequestException(
          'Order is not yet acknowledged by the merchant',
        );
      }

      const activeOrderExists = await manager.exists(Orders, {
        where: {
          riderId: lockedRider.id,
          status: In([
            OrderStatus.acknoledged,
            OrderStatus.picked_up,
            OrderStatus.in_transit,
          ]),
        },
      });
      if (activeOrderExists) {
        throw new BadRequestException(
          'Complete your active delivery before accepting another order',
        );
      }

      await assertRiderCanReceiveOrder(manager, lockedRider, lockedOrder);

      previousOrderStatus = lockedOrder.status;
      lockedOrder.status = OrderStatus.acknoledged;
      lockedOrder.riderId = lockedRider.id;
      lockedOrder.riderAssignedAt = acceptedAt;
      lockedOrder.riderAcceptedAt = acceptedAt;
      lockedOrder.isPaidOut = false;
      await manager.save(Orders, lockedOrder);
      await manager.save(
        OrderTracking,
        manager.create(OrderTracking, {
          orderId,
          orderStatus: OrderStatus.acknoledged,
          description: `Order accepted by rider ${rider.user?.firstName || rider.id}`,
        }),
      );
      assignmentChanged = true;
    });

    const acceptedOrder = await this.ordersRepository.findOne({
      where: { id: orderId },
      relations: [
        'store',
        'orderItems',
        'senderInfo',
        'recipientInfo',
        'user',
        'pickUpLocation',
        'dropOffLocation',
        'orderCharges',
        'orderCharges.chargeNodes',
        'rider',
        'rider.user',
      ],
    });
    if (!acceptedOrder) {
      throw new NotFoundException('Order not found after assignment');
    }

    if (assignmentChanged) {
      this.eventBus.publish(
        new OrderStatusChangedEvent(
          acceptedOrder.id,
          previousOrderStatus,
          OrderStatus.acknoledged,
          userId,
        ),
      );
    }

    // A rider who claimed the shared offer is already in the app with the
    // full order context. SMS is reserved for admin-assigned deliveries.

    return this.mapToOrderResponse(acceptedOrder);
  }

  async declineOrderOffer(
    orderId: string,
    userId: string,
    reason: string,
  ): Promise<StandardResponse> {
    const [rider, order] = await Promise.all([
      this.riderService.findByUserId(userId),
      this.ordersRepository.findOne({ where: { id: orderId } }),
    ]);
    if (!rider) throw new ForbiddenException('Only riders can decline offers');
    if (!order) throw new NotFoundException('Order not found');
    if (
      order.riderId ||
      ![OrderStatus.pending, OrderStatus.acknoledged].includes(order.status)
    ) {
      throw new BadRequestException('Order is no longer available');
    }

    await this.redisCacheService.setItemInCache(
      `rider-order-decline:${userId}:${orderId}`,
      { reason: reason.slice(0, 200), declinedAt: new Date().toISOString() },
      30 * 60 * 1000,
    );
    return new StandardResponse(false, 'ORDER_OFFER_DECLINED');
  }

  async hasDeclinedOrderOffer(
    userId: string,
    orderId: string,
  ): Promise<boolean> {
    return Boolean(
      await this.redisCacheService.getCachedItem(
        `rider-order-decline:${userId}:${orderId}`,
      ),
    );
  }

  async reportRiderIssue(
    orderId: string,
    userId: string,
    payload: {
      category: string;
      description: string;
      latitude?: number;
      longitude?: number;
    },
  ): Promise<StandardResponse> {
    const rider = await this.riderService.findByUserId(userId);
    if (!rider) throw new ForbiddenException('Only riders can report issues');
    const order = await this.ordersRepository.findOne({
      // Older order rows may contain Rider.userId rather than Rider.id.
      where: [
        { id: orderId, riderId: rider.id },
        { id: orderId, riderId: rider.userId },
      ],
      relations: ['store', 'user', 'pickUpLocation', 'dropOffLocation'],
    });
    if (!order) {
      throw new NotFoundException('Assigned order not found');
    }

    const category = payload.category.trim().slice(0, 80);
    const description = payload.description.trim().slice(0, 2000);
    const submittedAt = new Date();
    const activity = await this.analyticsService.trackUserActivity(
      userId,
      'rider_order_issue',
      {
        orderId,
        riderId: rider.id,
        category,
        description,
        latitude: payload.latitude,
        longitude: payload.longitude,
        status: order.status,
      },
    );

    const supportEmail =
      process.env.RIDER_ISSUE_SUPPORT_EMAIL?.trim() ||
      process.env.SUPPORT_EMAIL?.trim() ||
      'support@cushyaccess.com';
    // Persist first and respond without waiting on the email provider. This
    // prevents a slow provider from exceeding the Rider app's HTTP timeout and
    // causing a duplicate report retry after the record already exists.
    void this.mailSenderService
      .sendMail({
        recipient: supportEmail,
        subject: `Rider delivery issue: ${category} - ${orderId}`,
        template: 'rider-delivery-issue',
        content: {
          reference: activity.id,
          orderId,
          orderStatus: order.status,
          category,
          description,
          riderName:
            `${rider.user?.firstName || ''} ${rider.user?.lastName || ''}`.trim() ||
            rider.id,
          riderId: rider.id,
          riderPhone: rider.user?.mobile || 'Not available',
          customerName:
            `${order.user?.firstName || ''} ${order.user?.lastName || ''}`.trim() ||
            'Not available',
          merchantName: order.store?.name || 'Package delivery',
          pickupAddress:
            order.pickUpLocationAddress ||
            order.pickUpLocation?.address ||
            'Not available',
          dropoffAddress:
            order.dropOffLocationAddress ||
            order.dropOffLocation?.address ||
            'Not available',
          riderLocation:
            payload.latitude != null && payload.longitude != null
              ? `${payload.latitude}, ${payload.longitude}`
              : 'Not available',
          submittedAt: submittedAt.toISOString(),
        },
      })
      .then((mailResult) => {
        if (!mailResult) {
          this.logger.warn(
            `Rider issue ${activity.id} was recorded, but its support email was not delivered.`,
          );
        }
      })
      .catch((error) => {
        this.logger.warn(
          `Rider issue ${activity.id} was recorded, but support notification failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    return new StandardResponse(false, 'RIDER_ORDER_ISSUE_REPORTED', {
      reference: activity.id,
      supportNotificationQueued: true,
    });
  }

  /**
   * Pick up an order with tracking
   */
  async pickUpOrder(orderId: string, userId: string): Promise<any> {
    const rider = await this.riderService.findByUserId(userId);
    if (!rider) {
      throw new ForbiddenException('Only riders can pick up orders');
    }

    const order = await this.ordersRepository.findOne({
      where: { id: orderId, riderId: rider.id },
      relations: ['store', 'orderItems'],
    });

    if (!order) {
      throw new NotFoundException('Order not found or not assigned to you');
    }

    if (order.status !== OrderStatus.acknoledged) {
      throw new BadRequestException(
        `Order cannot be picked up (status: ${order.status})`,
      );
    }

    order.status = OrderStatus.picked_up;

    await this.ordersRepository.save(order);

    // Add tracking entry
    await this.addOrderTracking(
      orderId,
      OrderStatus.picked_up,
      `Order picked up by rider ${rider.user?.firstName || rider.id}`,
    );

    // Emit event
    this.eventBus.publish(
      new OrderStatusChangedEvent(
        order.id,
        OrderStatus.acknoledged,
        OrderStatus.picked_up,
        userId,
      ),
    );

    return this.mapToOrderResponse(order);
  }

  /**
   * Mark order as in transit with tracking
   */
  async markInTransit(orderId: string, userId: string): Promise<any> {
    const rider = await this.riderService.findByUserId(userId);
    if (!rider) {
      throw new ForbiddenException('Only riders can update order status');
    }

    const order = await this.ordersRepository.findOne({
      where: { id: orderId, riderId: rider.id },
    });

    if (!order) {
      throw new NotFoundException('Order not found or not assigned to you');
    }

    if (order.status !== OrderStatus.picked_up) {
      throw new BadRequestException(
        `Order cannot be marked in transit (status: ${order.status})`,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const transition = await manager
        .createQueryBuilder()
        .update(Orders)
        .set({ status: OrderStatus.in_transit })
        .where('id = :orderId', { orderId })
        .andWhere('"riderId" = :riderId', { riderId: rider.id })
        .andWhere('status = :status', { status: OrderStatus.picked_up })
        .execute();

      if (transition.affected !== 1) {
        throw new BadRequestException(
          'Order status changed before the trip could be started',
        );
      }

      await manager.getRepository(OrderTracking).save(
        manager.getRepository(OrderTracking).create({
          id: `otk_${uuidv4()}`,
          orderId,
          orderStatus: OrderStatus.in_transit,
          description: 'Order is in transit to customer',
        }),
      );
    });
    order.status = OrderStatus.in_transit;

    // Emit event
    this.eventBus.publish(
      new OrderStatusChangedEvent(
        order.id,
        OrderStatus.picked_up,
        OrderStatus.in_transit,
        userId,
      ),
    );

    return this.mapToOrderResponse(order);
  }

  /**
   * Get order timeline from tracking entries
   */
  async getOrderTimeline(orderId: string): Promise<any> {
    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const trackingEntries = await this.orderTrackingRepository.find({
      where: { orderId },
      order: { createdAt: 'ASC' },
    });

    return {
      orderId: order.id,
      currentStatus: order.status,
      timeline: trackingEntries.map((entry) => ({
        status: entry.orderStatus,
        description: entry.description,
        createdAt: entry.createdAt,
      })),
    };
  }

  /**
   * Get order with full tracking history
   */
  async getOrderWithTracking(orderId: string, userId: string): Promise<any> {
    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
      relations: [
        'store',
        'orderItems',
        'pickUpLocation',
        'dropOffLocation',
        'senderInfo',
        'recipientInfo',
        'orderCharges',
        'user',
        'orderTracking',
      ],
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Check permissions
    const isAdmin = await this.usersService.isAdmin(userId);
    const isRider =
      order.riderId && (await this.riderService.findByUserId(userId));

    if (
      !isAdmin &&
      order.userId !== userId &&
      (!isRider || order.riderId !== (isRider as any)?.id)
    ) {
      throw new ForbiddenException('You cannot view this order');
    }

    const response = this.mapToOrderResponse(order);

    // Add tracking timeline
    response.timeline =
      order.orderTracking?.map((entry) => ({
        status: entry.orderStatus,
        description: entry.description,
        createdAt: entry.createdAt,
      })) || [];

    return response;
  }
  async validatePickupCode(
    orderId: string,
    code: string,
    vendorUserId: string,
  ) {
    const normalizedCode = code?.trim();
    if (!orderId?.trim() || !normalizedCode) {
      throw new BadRequestException(
        new StandardResponse(true, 'ORDER_ID_AND_PICKUP_CODE_REQUIRED'),
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const lockedOrder = await manager.findOne(Orders, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedOrder) throw new NotFoundException('ORDER_NOT_FOUND');

      const order =
        (await manager.findOne(Orders, {
          where: { id: orderId },
          relations: ['store'],
        })) || lockedOrder;
      if (!order.store || order.store.userId !== vendorUserId) {
        throw new ForbiddenException('ORDER_DOES_NOT_BELONG_TO_VENDOR');
      }

      // Once ownership has been verified, compare the supplied code before
      // evaluating mutable order state. A wrong code must not masquerade as a
      // state error merely because assignment/status changed concurrently.
      if (order.pickupCode !== normalizedCode) {
        throw new BadRequestException('INVALID_PICKUP_CODE');
      }

      const latestTracking = await manager.findOne(OrderTracking, {
        where: { orderId },
        order: { createdAt: 'DESC' },
      });
      const currentStatus = latestTracking?.orderStatus ?? order.status;
      if (
        currentStatus === OrderStatus.picked_up ||
        currentStatus === OrderStatus.in_transit ||
        currentStatus === OrderStatus.delivered
      ) {
        return {
          changed: false,
          order,
          previousStatus: currentStatus,
        };
      }
      if (
        currentStatus !== OrderStatus.acknoledged ||
        order.status !== OrderStatus.acknoledged
      ) {
        throw new BadRequestException('ORDER_NOT_READY_FOR_PICKUP');
      }
      if (!order.riderId) {
        throw new BadRequestException('RIDER_NOT_ASSIGNED_TO_ORDER');
      }

      order.status = OrderStatus.picked_up;
      order.pickedUpAt = order.pickedUpAt || new Date();
      await manager.save(Orders, order);
      await manager.save(
        OrderTracking,
        manager.create(OrderTracking, {
          orderId: order.id,
          orderStatus: OrderStatus.picked_up,
          description: `Pickup confirmed by vendor ${vendorUserId}`,
        }),
      );
      return {
        changed: true,
        order,
        previousStatus: currentStatus,
      };
    });

    if (result.changed) {
      try {
        this.eventBus.publish(
          new OrderStatusChangedEvent(
            result.order.id,
            result.previousStatus,
            OrderStatus.picked_up,
            result.order.userId,
          ),
        );
      } catch (error) {
        this.logger.error(
          `Pickup for order ${orderId} was committed, but its event failed.`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return new StandardResponse(
      false,
      result.changed
        ? 'PICKUP_CODE_VALIDATED_SUCCESSFULLY'
        : 'PICKUP_CODE_ALREADY_VALIDATED',
      {
        orderId: result.order.id,
        status: result.order.status,
        previousStatus: result.previousStatus,
        pickedUpAt: result.order.pickedUpAt?.toISOString() || null,
      },
    );
  }
}

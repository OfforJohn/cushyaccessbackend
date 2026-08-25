import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { RiderConnectionService } from '../services/rider-connection.service';
import { JwtService } from '@nestjs/jwt';
import { Orders } from '../../orders/model/order.entity';
import { Rider, RiderStatus } from '../model/rider.entity';
import { ModuleRef } from '@nestjs/core';
import { DataSource, In, IsNull } from 'typeorm';
import { OrderStatus } from '../../orders/model/enum/order-status.enum';
import { RedisCacheService } from '../../redis-cache/redis-cache.service';
import { calculateRiderCommission } from '../rider-commission';
import { getRiderOrderOfferConfig } from '../rider-order-offer.config';
import { Users } from '../../users/model/users.entity';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/riders',
})
export class RiderGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RiderGateway.name);
  private readonly lastLocationPersistence = new Map<string, number>();

  constructor(private moduleRef: ModuleRef) {
    this.handleConnection = this.handleConnection.bind(this);
    this.handleDisconnect = this.handleDisconnect.bind(this);
  }

  async getAvailableOrdersForUser(userId: string): Promise<any[]> {
    const dataSource = this.moduleRef.get(DataSource, { strict: false });
    const rider = await dataSource.getRepository(Rider).findOne({
      where: { userId },
      select: { id: true, userId: true },
    });
    if (!rider) return [];
    return this.getAvailableOrdersDirect(50, 1, userId, rider.id);
  }

  private get connectionService(): RiderConnectionService {
    return this.moduleRef.get(RiderConnectionService, { strict: false });
  }

  private get jwtService(): JwtService {
    return this.moduleRef.get(JwtService, { strict: false });
  }

  private async getAvailableOrdersDirect(
    limit: number = 50,
    page: number = 1,
    userId?: string,
    riderId?: string,
  ): Promise<any[]> {
    try {
      if (!userId || !riderId) {
        this.logger.warn(
          'Available-order refresh rejected: rider identity missing.',
        );
        return [];
      }
      const dataSource = this.moduleRef.get(DataSource, { strict: false });
      const repo = dataSource.getRepository(Orders);
      const rider = await dataSource.getRepository(Rider).findOne({
        where: { id: riderId, userId },
      });
      const {
        radiusKm,
        limit: configuredLimit,
        maxLocationAgeMinutes,
      } = getRiderOrderOfferConfig();
      const safeLimit = Math.min(
        configuredLimit,
        Math.max(1, Math.trunc(Number(limit) || configuredLimit)),
      );
      const safePage = Math.max(1, Math.trunc(Number(page) || 1));
      const riderLatitude = Number(rider?.currentLatitude);
      const riderLongitude = Number(rider?.currentLongitude);
      const locationAge = rider?.lastLocationUpdate
        ? Date.now() - new Date(rider.lastLocationUpdate).getTime()
        : Number.POSITIVE_INFINITY;
      if (
        !rider ||
        !rider.isOnline ||
        rider.status !== 'active' ||
        !rider.trainingCompleted ||
        rider.backgroundCheckStatus !== 'approved' ||
        rider.currentLatitude == null ||
        rider.currentLongitude == null ||
        !Number.isFinite(riderLatitude) ||
        riderLatitude < -90 ||
        riderLatitude > 90 ||
        !Number.isFinite(riderLongitude) ||
        riderLongitude < -180 ||
        riderLongitude > 180 ||
        locationAge > maxLocationAgeMinutes * 60_000
      ) {
        this.logger.debug(
          `Available-order refresh suppressed for rider ${riderId}: rider is offline, uncleared, or has no fresh valid location.`,
        );
        return [];
      }

      const activeStatuses = [
        OrderStatus.acknoledged,
        OrderStatus.picked_up,
        OrderStatus.in_transit,
      ];
      const activeOrderExists = await repo.exists({
        where: [rider.id, rider.userId].map((assignedRiderId) => ({
          riderId: assignedRiderId,
          status: In(activeStatuses),
          cancelledAt: IsNull(),
          deliveredAt: IsNull(),
          rejectedAt: IsNull(),
        })),
      });
      if (activeOrderExists) {
        this.logger.debug(
          `Available-order refresh suppressed for rider ${riderId}: an active delivery already exists.`,
        );
        return [];
      }

      const pickupLatitude = `CASE WHEN "pickUpLocation"."latitude" ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN CAST("pickUpLocation"."latitude" AS double precision) ELSE NULL END`;
      const pickupLongitude = `CASE WHEN "pickUpLocation"."longitude" ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN CAST("pickUpLocation"."longitude" AS double precision) ELSE NULL END`;
      const pickupDistance = `ST_Distance(ST_MakePoint(${pickupLongitude}, ${pickupLatitude})::geography, ST_MakePoint(:riderLongitude, :riderLatitude)::geography)`;

      const queryBuilder = repo
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.store', 'store')
        .leftJoinAndSelect('order.orderItems', 'orderItems')
        .leftJoinAndSelect('order.pickUpLocation', 'pickUpLocation')
        .leftJoinAndSelect('order.dropOffLocation', 'dropOffLocation')
        .leftJoinAndSelect('order.senderInfo', 'senderInfo')
        .leftJoinAndSelect('order.recipientInfo', 'recipientInfo')
        .leftJoinAndSelect('order.orderTracking', 'ot')
        .leftJoinAndSelect('order.orderCharges', 'orderCharges')
        .leftJoinAndSelect('orderCharges.chargeNodes', 'chargeNodes')
        .leftJoinAndSelect('order.user', 'user')
        .where('order.riderId IS NULL')
        .andWhere('order.status IN (:...claimableStatuses)', {
          // Vendor acceptance records ACKNOWLEDGED in tracking while the row
          // remains PENDING; Admin status updates also write ACKNOWLEDGED to
          // the row. Both are legitimate unassigned, claimable deliveries.
          claimableStatuses: [OrderStatus.pending, OrderStatus.acknoledged],
        })
        .andWhere('order.scheduleDelivery = :scheduled', { scheduled: false })
        .andWhere(
          `(SELECT ot3."orderStatus" FROM "order_tracking" ot3 WHERE ot3."orderId" = "order"."id" ORDER BY ot3."createdAt" DESC LIMIT 1) = :ackStatus`,
          { ackStatus: OrderStatus.acknoledged },
        )
        .andWhere(`${pickupLatitude} BETWEEN -90 AND 90`)
        .andWhere(`${pickupLongitude} BETWEEN -180 AND 180`)
        .andWhere(
          `ST_DWithin(ST_MakePoint(${pickupLongitude}, ${pickupLatitude})::geography, ST_MakePoint(:riderLongitude, :riderLatitude)::geography, :offerRadiusMeters)`,
          {
            riderLongitude,
            riderLatitude,
            offerRadiusMeters: radiusKm * 1000,
          },
        )
        // PostgreSQL folds an unquoted camelCase ORDER BY alias to lowercase.
        // TypeORM quoted the SELECT alias but not the generated outer ORDER BY,
        // which made every availability refresh fail on `pickupdistance`.
        .addSelect(pickupDistance, 'pickup_distance')
        .orderBy('pickup_distance', 'ASC')
        .addOrderBy('order.createdAt', 'ASC')
        .skip((safePage - 1) * safeLimit)
        .take(safeLimit);

      let orders = await queryBuilder.getMany();
      if (userId && orders.length) {
        const cache = this.moduleRef.get(RedisCacheService, { strict: false });
        try {
          const decisions = await Promise.all(
            orders.map((order) =>
              cache.getCachedItem(`rider-order-decline:${userId}:${order.id}`),
            ),
          );
          orders = orders.filter((_, index) => !decisions[index]);
        } catch (error) {
          this.logger.warn(
            `Could not read declined offers for rider ${riderId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      this.logger.debug(
        `Available-order refresh returned ${orders.length} order(s) within ${radiusKm} km for rider ${riderId}.`,
      );
      return orders.map((order) => this.mapToOrderResponseDirect(order));
    } catch (error: any) {
      this.logger.error(
        `Error in getAvailableOrdersDirect: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private mapToOrderResponseDirect(order: Orders): any {
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

    // Do not infer a rider fee from service/packaging charges. If the
    // delivery-fee node is absent, settlement must remain zero and be audited.
    const finalDeliveryFee = deliveryFee;

    const commission = calculateRiderCommission(finalDeliveryFee);
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
      deliveryFee: finalDeliveryFee,
      riderPayout: commission.netRiderPayout,
      riderCommission: commission.platformCommission,
      riderCommissionRate: commission.platformCommissionRate,
      serviceFee,
      totalCharges: totalCharges || Number(order.Charges) || 0,
      discountAmount: Number(order.discountAmount) || 0,
      appliedCouponCode: order.appliedCouponCode,
      pickUpLocation: {
        address:
          order.pickUpLocationAddress ||
          order.pickUpLocation?.address ||
          'Pickup address unavailable',
        latitude: order.pickUpLocation?.latitude,
        longitude: order.pickUpLocation?.longitude,
      },
      dropOffLocation: {
        address:
          order.dropOffLocationAddress ||
          order.dropOffLocation?.address ||
          'Drop-off address unavailable',
        latitude: order.dropOffLocation?.latitude,
        longitude: order.dropOffLocation?.longitude,
      },
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
      },
      items:
        order.orderItems?.map((item) => ({
          id: item.id,
          name: item.name || 'Item',
          quantity: item.quantity || 1,
          unitPrice: Number(item.price) || 0,
          totalPrice: Number(item.price * item.quantity) || 0,
        })) || [],
      riderId: order.riderId,
      isPaidOut: order.isPaidOut,
      scheduleDelivery: order.scheduleDelivery,
      scheduleDeliveryDate: order.scheduleDeliveryDate?.toISOString(),
      scheduleDeliveryTime: order.scheduleDeliveryTime,
      createdAt: order.createdAt?.toISOString(),
      updatedAt: order.updatedAt?.toISOString(),
      acceptedAt: order.riderAcceptedAt?.toISOString(),
      pickedUpAt: order.pickedUpAt?.toISOString(),
      deliveredAt: order.deliveredAt?.toISOString(),
      cancelledAt: order.cancelledAt?.toISOString(),
      rejectedAt: order.rejectedAt?.toISOString(),
    };
  }

  async handleConnection(client: Socket) {
    try {
      // Extract token from query params or auth header
      let token =
        (client.handshake.auth?.token as string | undefined) ||
        (client.handshake.query.token as string | undefined);

      if (!token) {
        const authHeader = client.handshake.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          token = authHeader.split(' ')[1];
        }
      }

      if (!token) {
        throw new Error('No token found in query or authorization header');
      }

      // Verify with the same globally configured JwtService used to create
      // login tokens. Reading a second environment variable here caused HTTP
      // authentication to work while the live Rider socket was rejected.
      const payload = this.jwtService.verify(token) as {
        role?: string;
        sub?: string;
        userId?: string;
        sessionVersion?: number;
      };
      const role = String(payload.role || '').toUpperCase();
      const userId = payload.sub || payload.userId;

      if (!userId || !role) {
        throw new Error('Invalid token payload');
      }

      const dataSource = this.moduleRef.get(DataSource, { strict: false });
      const authenticatedUser = await dataSource.getRepository(Users).findOne({
        where: { id: userId },
        select: { id: true, userRole: true, sessionVersion: true },
      });
      if (
        !authenticatedUser ||
        String(authenticatedUser.userRole).toUpperCase() !== role ||
        (payload.sessionVersion ?? 0) !==
          (authenticatedUser.sessionVersion ?? 0)
      ) {
        throw new Error('Account is missing or session has been revoked');
      }

      let riderId: string | undefined;
      if (role === 'RIDER') {
        const rider = await dataSource.getRepository(Rider).findOne({
          where: { userId },
          select: { id: true, userId: true },
        });
        if (!rider) {
          throw new Error('Rider profile not found');
        }
        riderId = rider.id;
      }

      const existingSocketId =
        this.connectionService.getSocketIdByUserId(userId);
      if (existingSocketId && existingSocketId !== client.id) {
        const existingSocket =
          this.server.sockets.sockets.get(existingSocketId);
        existingSocket?.emit('session:replaced', {
          message: 'Your rider account was connected on another device.',
        });
        existingSocket?.disconnect(true);
        this.connectionService.removeConnection(existingSocketId);
      }
      this.connectionService.addConnection(client.id, userId, role, riderId);
      // A deterministic room lets any PM2 process reach this user through the
      // Socket.IO Redis adapter; process-local socket-id maps cannot do that.
      client.join(this.getUserRoom(userId));

      if (role === 'RIDER') {
        client.join('riders-online');
      }

      client.emit(role === 'RIDER' ? 'rider:connected' : 'customer:connected', {
        status: 'success',
        userId,
        socketId: client.id,
      });
    } catch (error: any) {
      Logger.warn(
        `Connection rejected for client ${client.id}: ${error.message}`,
        'RiderGateway',
      );
      client.emit('rider:connect_error', { message: 'Connection rejected' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const riderId = this.connectionService.getRiderIdBySocketId(client.id);
    if (riderId) this.lastLocationPersistence.delete(riderId);
    this.connectionService.removeConnection(client.id);
  }

  @SubscribeMessage('rider:update-location')
  async handleUpdateLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    const userId = this.connectionService.getUserIdBySocketId(client.id);
    const riderId = this.connectionService.getRiderIdBySocketId(client.id);
    if (
      !userId ||
      !riderId ||
      this.connectionService.getRoleBySocketId(client.id) !== 'RIDER'
    ) {
      Logger.warn(
        `Location update from unknown socket ${client.id}`,
        'RiderGateway',
      );
      return { status: 'error', message: 'Not authenticated' };
    }

    const location = data.location || {
      latitude: data.latitude,
      longitude: data.longitude,
      speed: data.speed,
      heading: data.heading,
      accuracy: data.accuracy,
      batteryLevel: data.batteryLevel,
    };

    if (
      !location ||
      typeof location.latitude !== 'number' ||
      typeof location.longitude !== 'number' ||
      !Number.isFinite(location.latitude) ||
      !Number.isFinite(location.longitude) ||
      location.latitude < -90 ||
      location.latitude > 90 ||
      location.longitude < -180 ||
      location.longitude > 180
    ) {
      return { status: 'error', message: 'Invalid location data' };
    }

    const now = Date.now();
    const shouldPersist =
      now - (this.lastLocationPersistence.get(riderId) || 0) >= 30_000;
    let locationWasPersisted = false;
    if (shouldPersist) {
      try {
        const dataSource = this.moduleRef.get(DataSource, { strict: false });
        const update = await dataSource.getRepository(Rider).update(
          {
            id: riderId,
            userId,
            isOnline: true,
            status: RiderStatus.ACTIVE,
          },
          {
            currentLatitude: location.latitude,
            currentLongitude: location.longitude,
            currentLocation: `POINT(${location.longitude} ${location.latitude})`,
            lastLocationUpdate: new Date(now),
          },
        );
        if (update.affected !== 1) {
          return { status: 'error', message: 'Rider is not active and online' };
        }
        this.lastLocationPersistence.set(riderId, now);
        locationWasPersisted = true;
      } catch (error) {
        this.logger.error(
          `Unable to persist socket location for rider ${riderId}.`,
          error instanceof Error ? error.stack : String(error),
        );
        return { status: 'error', message: 'Unable to update rider location' };
      }
    }

    this.connectionService.updateLocation(riderId, {
      ...location,
      orderId: data.orderId,
    });

    const payload = {
      riderId,
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        speed: location.speed,
        heading: location.heading,
        accuracy: location.accuracy,
      },
      orderId: data.orderId,
      batteryLevel: data.batteryLevel,
      timestamp: new Date().toISOString(),
    };

    // Broadcast location update to all customers tracking this rider
    this.server
      .to(`rider-room-${riderId}`)
      .emit('rider:location-updated', payload);
    this.server.to(`rider-room-${riderId}`).emit('rider:location', payload);

    // The socket commonly connects before the device's first fresh location.
    // Refresh the proximity-scoped list immediately after that location is
    // persisted so a rider does not need to reconnect to see nearby work.
    if (locationWasPersisted) {
      const availableOrders = await this.getAvailableOrdersDirect(
        50,
        1,
        userId,
        riderId,
      );
      // Emit both names during the protocol transition. They carry the same
      // one-query snapshot and the app de-duplicates orders by id.
      client.emit('rider:new-orders-available', {
        orders: availableOrders,
        count: availableOrders.length,
        timestamp: new Date(),
      });
      client.emit('rider:available-orders', { availableOrders });
    }

    return { status: 'success', message: 'Location updated', data: payload };
  }

  @SubscribeMessage('customer:start-tracking')
  async handleCustomerStartTracking(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { riderId: string; customerId?: string; orderId?: string },
  ) {
    try {
      const authenticatedUserId = this.connectionService.getUserIdBySocketId(
        client.id,
      );
      const role = this.connectionService.getRoleBySocketId(client.id);
      const { riderId, orderId } = data;
      if (!authenticatedUserId || role !== 'CUSTOMER') {
        return { status: 'error', message: 'Unauthorized' };
      }
      if (!orderId) {
        return { status: 'error', message: 'orderId is required' };
      }

      const dataSource = this.moduleRef.get(DataSource, { strict: false });
      const orderRepo = dataSource.getRepository(Orders);
      const orderObj = await orderRepo.findOne({
        where: { id: orderId, userId: authenticatedUserId },
        relations: ['rider', 'rider.user'],
      });
      const riderObj = orderObj?.rider;
      if (!orderObj || !riderObj) {
        return { status: 'error', message: 'Assigned order not found' };
      }
      if (riderId && riderId !== riderObj.id && riderId !== riderObj.userId) {
        return { status: 'error', message: 'Rider is not assigned to order' };
      }

      this.connectionService.linkUserAndRider(riderObj.userId, riderObj.id);

      const roomName = `rider-room-${riderObj.id}`;
      client.join(roomName);
      client.join(`rider-room-${riderObj.userId}`);

      const connectedLocation =
        this.connectionService.getLocation(riderObj.id) ||
        this.connectionService.getLocation(riderObj.userId);
      const hasPersistedCoordinateValues =
        riderObj.currentLatitude !== null &&
        riderObj.currentLatitude !== undefined &&
        riderObj.currentLongitude !== null &&
        riderObj.currentLongitude !== undefined;
      const persistedLatitude = Number(riderObj.currentLatitude);
      const persistedLongitude = Number(riderObj.currentLongitude);
      const hasPersistedLocation =
        hasPersistedCoordinateValues &&
        Number.isFinite(persistedLatitude) &&
        persistedLatitude >= -90 &&
        persistedLatitude <= 90 &&
        Number.isFinite(persistedLongitude) &&
        persistedLongitude >= -180 &&
        persistedLongitude <= 180;
      const currentLocation =
        connectedLocation ||
        (hasPersistedLocation
          ? {
              latitude: persistedLatitude,
              longitude: persistedLongitude,
              speed: undefined,
              heading: undefined,
              accuracy: undefined,
              updatedAt: riderObj.lastLocationUpdate,
            }
          : null);
      const locationUpdatedAt = currentLocation?.updatedAt
        ? new Date(currentLocation.updatedAt).getTime()
        : Number.NaN;
      const hasFreshPersistedLocation =
        Number.isFinite(locationUpdatedAt) &&
        Date.now() - locationUpdatedAt <= 2 * 60_000;
      const isOnline =
        this.connectionService.isRiderOnline(riderObj.id) ||
        this.connectionService.isRiderOnline(riderObj.userId) ||
        Boolean(riderObj.isOnline && hasFreshPersistedLocation);

      const riderName = riderObj?.user
        ? `${riderObj.user.firstName || ''} ${riderObj.user.lastName || ''}`.trim() ||
          riderObj.user.email ||
          riderObj.user.mobile
        : '';

      // Fetch rider info
      const riderInfo = {
        name: riderName || 'Rider',
        phone: riderObj?.user?.mobile || '',
        bikeType: riderObj?.bikeType || null,
        bikeColor: riderObj?.bikeColor || null,
        licensePlate: riderObj?.licensePlate || '',
        rating: riderObj?.rating ? Number(riderObj.rating) : 0,
        totalDeliveries: riderObj?.totalDeliveries || 0,
        isOnline,
      };

      const response = {
        riderId: riderObj.id,
        orderId,
        riderInfo,
        currentLocation: currentLocation
          ? {
              latitude: currentLocation.latitude,
              longitude: currentLocation.longitude,
              speed: currentLocation.speed,
              heading: currentLocation.heading,
              accuracy: currentLocation.accuracy,
              updatedAt: Number.isFinite(locationUpdatedAt)
                ? new Date(locationUpdatedAt).toISOString()
                : undefined,
            }
          : null,
        timestamp: new Date().toISOString(),
        message: 'Tracking started successfully',
      };

      client.emit('customer:tracking-started', response);
      return { status: 'success', data: response };
    } catch (error: any) {
      Logger.error(
        `Error in customer:start-tracking: ${error.message}`,
        'RiderGateway',
      );
      return { status: 'error', message: error.message };
    }
  }

  @SubscribeMessage('customer:stop-tracking')
  handleCustomerStopTracking(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { riderId: string; customerId?: string },
  ) {
    if (data?.riderId) {
      client.leave(`rider-room-${data.riderId}`);
    }
    const response = {
      success: true,
      message: 'Tracking stopped',
      timestamp: new Date().toISOString(),
    };
    client.emit('customer:tracking-stopped', response);
    return { status: 'success', data: response };
  }

  @SubscribeMessage('customer:request-live-location')
  handleRequestLiveLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { riderId: string },
  ) {
    if (!client.rooms.has(`rider-room-${data.riderId}`)) {
      return { status: 'error', message: 'Tracking is not authorized' };
    }
    const location = this.connectionService.getLocation(data.riderId);
    if (location) {
      client.emit('rider:location-updated', {
        riderId: data.riderId,
        location,
        timestamp: location.updatedAt
          ? new Date(location.updatedAt).toISOString()
          : new Date().toISOString(),
      });
    }
    return { status: 'success' };
  }

  broadcastRiderLocationUpdate(data: {
    riderId: string;
    latitude: number;
    longitude: number;
    accuracy?: number;
    altitude?: number;
    speed?: number;
    heading?: number;
    timestamp?: Date;
    batteryLevel?: number;
  }) {
    const payload = {
      riderId: data.riderId,
      location: {
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy: data.accuracy,
        altitude: data.altitude,
        speed: data.speed,
        heading: data.heading,
      },
      batteryLevel: data.batteryLevel,
      timestamp: (data.timestamp || new Date()).toISOString(),
    };
    this.connectionService.updateLocation(data.riderId, payload.location);
    this.server
      .to(`rider-room-${data.riderId}`)
      .emit('rider:location-updated', payload);
  }

  @SubscribeMessage('rider:subscribe-orders')
  async handleSubscribeOrders(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      riderId: string;
      filters?: any;
    },
  ): Promise<any> {
    try {
      const userId = this.connectionService.getUserIdBySocketId(client.id);
      const riderId = this.connectionService.getRiderIdBySocketId(client.id);
      if (
        !userId ||
        !riderId ||
        this.connectionService.getRoleBySocketId(client.id) !== 'RIDER'
      ) {
        return { event: 'error', data: { message: 'Unauthorized' } };
      }

      client.join(`rider-orders-${riderId}`);

      const availableOrders = await this.getAvailableOrdersDirect(
        data.filters?.limit || 50,
        data.filters?.page || 1,
        userId,
        riderId,
      );

      return {
        data: {
          success: true,
          message: 'Subscribed to live orders',
          availableOrders,
          count: availableOrders.length,
          timestamp: new Date(),
        },
      };
    } catch (error: any) {
      Logger.error(`Subscribe orders error: ${error.message}`, 'RiderGateway');
      return {
        event: 'error',
        data: { message: 'Failed to subscribe to orders' },
      };
    }
  }

  @SubscribeMessage('rider:get-available-orders')
  async handleGetAvailableOrders(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      riderId: string;
      limit?: number;
      page?: number;
    },
  ): Promise<any> {
    try {
      const userId = this.connectionService.getUserIdBySocketId(client.id);
      const riderId = this.connectionService.getRiderIdBySocketId(client.id);
      if (
        !userId ||
        !riderId ||
        this.connectionService.getRoleBySocketId(client.id) !== 'RIDER'
      ) {
        return { event: 'error', data: { message: 'Unauthorized' } };
      }

      const orders = await this.getAvailableOrdersDirect(
        data.limit || 50,
        data.page || 1,
        userId,
        riderId,
      );

      return {
        data: {
          orders,
          count: orders.length,
          timestamp: new Date(),
        },
      };
    } catch (error: any) {
      Logger.error(
        `Get available orders error: ${error.message}`,
        'RiderGateway',
      );
      return {
        event: 'error',
        data: { message: 'Failed to get available orders' },
      };
    }
  }

  // --- Methods to be called from other modules ---

  mapOrderResponsePublic(order: Orders): any {
    return this.mapOrderResponse(order);
  }

  private mapOrderResponse(order: Orders): any {
    const sortedTracking = [...(order.orderTracking || [])].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const currentStatus =
      sortedTracking.length > 0
        ? sortedTracking[sortedTracking.length - 1].orderStatus
        : order.status;
    const deliveryFee = Number(
      order.orderCharges?.chargeNodes?.find(
        (node) => node.name === 'deliveryFee',
      )?.amount || 0,
    );
    const commission = calculateRiderCommission(deliveryFee);
    return {
      id: order.id,
      status: currentStatus,
      riderId: order.riderId,
      isAvailable: !order.riderId && order.status === OrderStatus.pending,
      type: order.type,
      storeId: order.storeId,
      storeName: order.store?.name,
      totalItems: order.totalItems,
      totalAmount: Number(order.totalAmount) || 0,
      deliveryFee: commission.grossDeliveryFee,
      riderPayout: commission.netRiderPayout,
      riderCommission: commission.platformCommission,
      riderCommissionRate: commission.platformCommissionRate,
      pickUpLocation: {
        address: order.pickUpLocationAddress,
        latitude: order.pickUpLocation?.latitude,
        longitude: order.pickUpLocation?.longitude,
      },
      dropOffLocation: {
        address: order.dropOffLocationAddress,
        latitude: order.dropOffLocation?.latitude,
        longitude: order.dropOffLocation?.longitude,
      },
      noteForRider: order.noteForRider,
      senderInfo: {
        name: order.senderInfo?.fullName,
        phone: order.senderInfo?.phoneNumber,
      },
      recipientInfo: {
        name: order.recipientInfo?.fullName,
        phone: order.recipientInfo?.phoneNumber,
      },
      items:
        order.orderItems?.map((item) => ({
          id: item.id,
          name: item.name || 'Item',
          quantity: item.quantity || 1,
          unitPrice: Number(item.price) || 0,
          totalPrice: Number(item.price * (item.quantity || 1)) || 0,
        })) || [],
      createdAt: order.createdAt.toISOString(),
    };
  }

  /**
   * Send a new order notification to a specific rider
   */
  notifyNewOrder(userId: string, orderData: any) {
    this.server
      .to(this.getUserRoom(userId))
      .emit('order:new_available', orderData);
    return true;
  }

  /**
   * Broadcast order status update to assigned rider
   */
  notifyOrderStatusUpdate(userId: string, orderId: string, status: string) {
    this.server
      .to(this.getUserRoom(userId))
      .emit('order:status_update', { orderId, status });
    return true;
  }

  /** Remove an assigned, cancelled, rejected, or otherwise closed offer from
   * every rider's shared availability pool. The payload intentionally contains
   * no customer or address data. */
  notifyOrderUnavailable(
    orderId: string,
    status: string,
    assigned: boolean = false,
    excludedUserId?: string,
  ) {
    // The winning rider receives a targeted status update and proceeds to the
    // active delivery. Only competing riders should receive the shared-pool
    // "unavailable" event, otherwise the winner can be told that their own
    // successful claim was taken by somebody else.
    const emitter = excludedUserId
      ? this.server.except(this.getUserRoom(excludedUserId))
      : this.server;
    emitter.emit('order:unavailable', {
      orderId,
      status,
      ...(assigned ? { assigned: true } : {}),
    });
    return true;
  }

  private getUserRoom(userId: string): string {
    return `authenticated-user:${userId}`;
  }
}

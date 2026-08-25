import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { StandardResponse } from 'src/common/module/standard-response';
import { Orders } from 'src/orders/model/order.entity';
import { OrderStatus } from 'src/orders/model/enum/order-status.enum';
import { OrderTracking } from 'src/orders/model/order-tracking.entity';
import { Rider, RiderStatus } from 'src/riders/model/rider.entity';
import { MobileSenderService } from 'src/user-otp/mobile-sender.service';
import { assertRiderCanReceiveOrder } from 'src/riders/rider-order-proximity';
import { composeDeliveryAddress } from 'src/orders/delivery-address';
import { OrderTypes } from 'src/orders/model/enum/order-types.enum';
import { FCMTokenService } from 'src/users/services/fcm-token.service';
import { EventBus } from '@nestjs/cqrs';
import { OrderStatusChangedEvent } from 'src/events';

const ACTIVE_DELIVERY_STATUSES = [
  OrderStatus.acknoledged,
  OrderStatus.picked_up,
  OrderStatus.in_transit,
];

const normalizeMessageText = (value?: string | null): string =>
  (value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const truncateMessageText = (value: string, maxLength: number): string =>
  value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 3))}...`
    : value;

const firstMessageText = (
  ...values: Array<string | null | undefined>
): string => values.map(normalizeMessageText).find(Boolean) || '';

@Injectable()
export class AssignRideToOrderUseCase {
  private readonly logger = new Logger(AssignRideToOrderUseCase.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly fcmTokenService: FCMTokenService,
    private readonly mobileSenderService: MobileSenderService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(orderId: string, riderId: string) {
    if (!orderId?.trim() || !riderId?.trim()) {
      throw new BadRequestException('Order ID and rider ID are required');
    }

    const assignableStatuses = [OrderStatus.pending, OrderStatus.acknoledged];
    let changed = false;
    let riderUserId = '';
    let riderNote = '';
    let deliveryAddress = '';
    let customerName = '';
    let customerPhone = '';
    let customerCallingCode = '';
    let pickupName = '';
    let pickupLocation = '';
    let pickupPhone = '';
    let pickupCallingCode = '';
    let pickupTypeLabel = 'Pickup point';
    let previousOrderStatus = OrderStatus.pending;
    await this.dataSource.transaction(async (manager) => {
      // Use the same rider-then-order lock order as mobile acceptance.
      const rider = await manager.findOne(Rider, {
        where: { id: riderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!rider) throw new NotFoundException('Rider not found');
      riderUserId = rider.userId;
      if (rider.status !== RiderStatus.ACTIVE) {
        throw new BadRequestException('Rider is not active');
      }
      if (
        !rider.trainingCompleted ||
        rider.backgroundCheckStatus !== 'approved'
      ) {
        throw new BadRequestException('Rider has not completed clearance');
      }

      const lockedOrder = await manager.findOne(Orders, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedOrder) throw new NotFoundException('Order not found');
      // PostgreSQL cannot apply FOR UPDATE to the nullable side of the LEFT
      // JOINs TypeORM creates for these relations. Lock the order row first,
      // then hydrate it within the same transaction.
      const order =
        (await manager.findOne(Orders, {
          where: { id: orderId },
          relations: [
            'recipientInfo',
            'dropOffLocation',
            'pickUpLocation',
            'user',
            'store',
            'store.address',
            'store.user',
            'senderInfo',
          ],
        })) || lockedOrder;
      riderNote = normalizeMessageText(order.noteForRider);
      if (
        order.riderId === rider.id &&
        ACTIVE_DELIVERY_STATUSES.includes(order.status)
      ) {
        return;
      }
      if (order.riderId) {
        throw new ConflictException(
          'Order is already assigned to another rider',
        );
      }
      if (!assignableStatuses.includes(order.status)) {
        throw new BadRequestException(
          `Cannot assign a rider to an order with status ${order.status}`,
        );
      }
      const activeJob = await manager.exists(Orders, {
        where: { riderId: rider.id, status: In(ACTIVE_DELIVERY_STATUSES) },
      });
      if (activeJob) {
        throw new ConflictException('Rider already has an active delivery');
      }

      await assertRiderCanReceiveOrder(manager, rider, order);

      deliveryAddress =
        composeDeliveryAddress(
          firstMessageText(
            order.dropOffLocation?.address,
            order.dropOffLocationAddress,
          ),
          firstMessageText(
            order.recipientInfo?.deliveryAddress,
            order.fullHouseAddress,
          ),
        ) || 'the address shown in the app';
      customerName =
        firstMessageText(
          order.recipientInfo?.fullName,
          `${order.user?.firstName || ''} ${order.user?.lastName || ''}`,
        ) || 'Customer';
      customerPhone = firstMessageText(
        order.recipientInfo?.phoneNumber,
        order.additionalPhoneNumber,
        order.user?.mobile,
      );
      customerCallingCode = order.user?.callingCode || '';
      pickupName =
        firstMessageText(order.store?.name) ||
        (order.type === OrderTypes.logistics
          ? 'the pickup point'
          : 'the merchant');
      pickupLocation =
        firstMessageText(
          order.store?.address?.address,
          order.pickUpLocation?.address,
          order.pickUpLocationAddress,
        ) || 'the pickup location shown in the app';
      pickupPhone = firstMessageText(
        order.store?.mobile,
        order.store?.user?.mobile,
        order.senderInfo?.phoneNumber,
      );
      pickupCallingCode = order.store?.user?.callingCode || '';
      pickupTypeLabel = this.getPickupTypeLabel(order);

      const assignedAt = new Date();
      previousOrderStatus = order.status;
      order.riderId = rider.id;
      order.status = OrderStatus.acknoledged;
      order.riderAssignedAt = assignedAt;
      order.riderAcceptedAt = assignedAt;
      order.isPaidOut = false;
      await manager.save(Orders, order);
      await manager.save(
        OrderTracking,
        manager.create(OrderTracking, {
          orderId: order.id,
          orderStatus: OrderStatus.acknoledged,
          description: `Order assigned to rider ${rider.id} by an administrator`,
        }),
      );
      changed = true;
    });

    if (changed) {
      this.eventBus.publish(
        new OrderStatusChangedEvent(
          orderId,
          previousOrderStatus,
          OrderStatus.acknoledged,
          riderUserId,
        ),
      );
      try {
        await this.fcmTokenService.sendPushNotification({
          title: 'Delivery Assigned',
          subtitle: 'Active Delivery',
          body:
            `Delivery from ${truncateMessageText(pickupName, 80)} in ${truncateMessageText(pickupLocation, 120)} has been assigned to you.` +
            (riderNote
              ? ` Customer note: ${truncateMessageText(riderNote, 140)}`
              : ' Tap to review.'),
          userIds: [riderUserId],
          sound: 'default',
          data: {
            route: 'RIDER_ORDER_ASSIGNED',
            assigned: true,
            orderId,
            noteForRider: truncateMessageText(riderNote, 500) || undefined,
            customerName: truncateMessageText(customerName, 120),
            customerPhone: truncateMessageText(customerPhone, 40) || undefined,
            deliveryAddress: truncateMessageText(deliveryAddress, 700),
            pickupName: truncateMessageText(pickupName, 120),
            pickupLocation: truncateMessageText(pickupLocation, 300),
            pickupPhone: truncateMessageText(pickupPhone, 40) || undefined,
          },
        });
      } catch (error) {
        this.logger.warn(
          `Could not publish rider assignment push for order ${orderId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      await this.sendRiderAssignmentSms(riderId, {
        orderId,
        riderNote,
        deliveryAddress,
        customerName,
        customerPhone,
        customerCallingCode,
        pickupName,
        pickupLocation,
        pickupPhone,
        pickupCallingCode,
        pickupTypeLabel,
      });
    }

    return new StandardResponse(
      false,
      changed ? 'RIDER_ASSIGNED_SUCCESSFULLY' : 'RIDER_ALREADY_ASSIGNED',
      {
        orderId,
        riderId,
      },
    );
  }

  private getPickupTypeLabel(order: Orders): string {
    switch (String(order.store?.category || '').toLowerCase()) {
      case 'restaurant':
      case 'local_food':
        return 'Restaurant';
      case 'med_tech':
        return 'Pharmacy';
      case 'grocery':
      case 'super_market':
        return 'Store';
      default:
        return order.store ? 'Merchant' : 'Pickup point';
    }
  }

  private async sendRiderAssignmentSms(
    riderId: string,
    data: {
      orderId: string;
      riderNote: string;
      deliveryAddress: string;
      customerName: string;
      customerPhone: string;
      customerCallingCode?: string;
      pickupName: string;
      pickupLocation: string;
      pickupPhone: string;
      pickupCallingCode?: string;
      pickupTypeLabel: string;
    },
  ): Promise<void> {
    try {
      const assignedRider = await this.dataSource
        .getRepository(Rider)
        .findOne({ where: { id: riderId }, relations: ['user'] });
      if (!assignedRider?.user?.mobile) return;

      await this.mobileSenderService.sendRiderAssignmentSms(
        assignedRider.user.mobile,
        {
          riderName:
            `${assignedRider.user.firstName || ''} ${assignedRider.user.lastName || ''}`.trim() ||
            'Rider',
          riderCallingCode: assignedRider.user.callingCode,
          riderNote: data.riderNote,
          deliveryAddress: data.deliveryAddress,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          customerCallingCode: data.customerCallingCode,
          pickupName: data.pickupName,
          pickupLocation: data.pickupLocation,
          pickupPhone: data.pickupPhone,
          pickupCallingCode: data.pickupCallingCode,
          pickupTypeLabel: data.pickupTypeLabel,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not send rider assignment SMS for order ${data.orderId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

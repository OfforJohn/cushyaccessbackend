import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MonitoringGateway } from '../gateways/monitoring.gateway';
import {
  OrderCreatedEvent,
  OrderStatusChangedEvent,
  OrderAcceptedEvent,
  OrderPickedUpEvent,
  OrderDeliveredEvent,
  OrderCancelledEvent,
} from '../../events';

@Injectable()
export class OrderEventHandler {
  private readonly logger = new Logger(OrderEventHandler.name);

  constructor(
    private readonly monitoringGateway: MonitoringGateway,
  ) {}

  @OnEvent('OrderCreatedEvent')
  handleOrderCreated(event: OrderCreatedEvent) {
    this.logger.log(`Order created: ${event.orderId}`);
    
    // Broadcast to operations room
    this.monitoringGateway.broadcastOperationsUpdate({
      type: 'order_created',
      orderId: event.orderId,
      userId: event.userId,
      timestamp: event.timestamp,
    });
  }

  @OnEvent('OrderStatusChangedEvent')
  handleOrderStatusChanged(event: OrderStatusChangedEvent) {
    this.logger.log(`Order status changed: ${event.orderId} from ${event.oldStatus} to ${event.newStatus}`);
    
    // Broadcast to operations room
    this.monitoringGateway.broadcastOperationsUpdate({
      type: 'order_status_changed',
      orderId: event.orderId,
      oldStatus: event.oldStatus,
      newStatus: event.newStatus,
      userId: event.userId,
      timestamp: event.timestamp,
    });
  }

  @OnEvent('OrderAcceptedEvent')
  handleOrderAccepted(event: OrderAcceptedEvent) {
    this.logger.log(`Order accepted: ${event.orderId} by rider ${event.riderId}`);
    
    this.monitoringGateway.broadcastOperationsUpdate({
      type: 'order_accepted',
      orderId: event.orderId,
      riderId: event.riderId,
      userId: event.userId,
      timestamp: event.timestamp,
    });
  }

  @OnEvent('OrderPickedUpEvent')
  handleOrderPickedUp(event: OrderPickedUpEvent) {
    this.logger.log(`Order picked up: ${event.orderId} by rider ${event.riderId}`);
    
    this.monitoringGateway.broadcastOperationsUpdate({
      type: 'order_picked_up',
      orderId: event.orderId,
      riderId: event.riderId,
      userId: event.userId,
      timestamp: event.timestamp,
    });
  }

  @OnEvent('OrderDeliveredEvent')
  handleOrderDelivered(event: OrderDeliveredEvent) {
    this.logger.log(`Order delivered: ${event.orderId} by rider ${event.riderId}`);
    
    this.monitoringGateway.broadcastOperationsUpdate({
      type: 'order_delivered',
      orderId: event.orderId,
      riderId: event.riderId,
      userId: event.userId,
      deliveryData: event.deliveryData,
      timestamp: event.timestamp,
    });
  }

  @OnEvent('OrderCancelledEvent')
  handleOrderCancelled(event: OrderCancelledEvent) {
    this.logger.log(`Order cancelled: ${event.orderId} - ${event.reason}`);
    
    this.monitoringGateway.broadcastOperationsUpdate({
      type: 'order_cancelled',
      orderId: event.orderId,
      userId: event.userId,
      reason: event.reason,
      timestamp: event.timestamp,
    });
  }
}
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MonitoringGateway } from '../gateways/monitoring.gateway';
import {
  RiderOnlineStatusChangedEvent,
  RiderLocationUpdatedEvent,
  RiderStatusChangedEvent,
  RiderEarningsUpdatedEvent,
} from '../../events';

@Injectable()
export class RiderEventHandler {
  private readonly logger = new Logger(RiderEventHandler.name);

  constructor(
    private readonly monitoringGateway: MonitoringGateway,
  ) {}

  @OnEvent('RiderOnlineStatusChangedEvent')
  handleRiderOnlineStatusChanged(event: RiderOnlineStatusChangedEvent) {
    this.logger.log(`Rider ${event.riderId} online status changed to: ${event.isOnline}`);
    
    this.monitoringGateway.broadcastOperationsUpdate({
      type: 'rider_online_status_changed',
      riderId: event.riderId,
      isOnline: event.isOnline,
      timestamp: event.timestamp,
    });
  }

  @OnEvent('RiderLocationUpdatedEvent')
  handleRiderLocationUpdated(event: RiderLocationUpdatedEvent) {
    this.logger.debug(`Rider ${event.riderId} location updated`);
    
    // Broadcast live map update
    this.monitoringGateway.broadcastLiveMapUpdate({
      type: 'rider_location_updated',
      riderId: event.riderId,
      latitude: event.latitude,
      longitude: event.longitude,
      accuracy: event.accuracy,
      timestamp: event.timestamp,
    });
  }

  @OnEvent('RiderStatusChangedEvent')
  handleRiderStatusChanged(event: RiderStatusChangedEvent) {
    this.logger.log(`Rider ${event.riderId} status changed from ${event.oldStatus} to ${event.newStatus}`);
    
    this.monitoringGateway.broadcastOperationsUpdate({
      type: 'rider_status_changed',
      riderId: event.riderId,
      oldStatus: event.oldStatus,
      newStatus: event.newStatus,
      updatedBy: event.updatedBy,
      reason: event.reason,
      timestamp: event.timestamp,
    });
  }

  @OnEvent('RiderEarningsUpdatedEvent')
  handleRiderEarningsUpdated(event: RiderEarningsUpdatedEvent) {
    this.logger.log(`Rider ${event.riderId} earnings updated: ${event.amount}`);
    
    this.monitoringGateway.broadcastToRiders('earnings_updated', {
      riderId: event.riderId,
      amount: event.amount,
      orderId: event.orderId,
      type: event.type,
      timestamp: event.timestamp,
    });
  }
}
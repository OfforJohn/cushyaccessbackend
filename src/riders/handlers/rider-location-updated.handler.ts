import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { RiderLocationUpdatedEvent } from '../events/rider-location-updated.event';
import { RiderGateway } from '../gateways/rider.gateway';

@EventsHandler(RiderLocationUpdatedEvent)
export class RiderLocationUpdatedHandler implements IEventHandler<RiderLocationUpdatedEvent> {
  constructor(private readonly riderGateway: RiderGateway) {}

  handle(event: RiderLocationUpdatedEvent) {
    this.riderGateway.broadcastRiderLocationUpdate(event);
  }
}

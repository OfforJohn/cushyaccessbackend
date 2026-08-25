import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderStatusChangedEvent } from '../../events';
import { RiderGateway } from '../../riders/gateways/rider.gateway';
import { Rider } from '../../riders/model/rider.entity';
import { OrderStatus } from '../model/enum/order-status.enum';
import { Orders } from '../model/order.entity';

@EventsHandler(OrderStatusChangedEvent)
export class OrderStatusChangedHandler implements IEventHandler<OrderStatusChangedEvent> {
  constructor(
    @InjectRepository(Orders)
    private readonly ordersRepository: Repository<Orders>,
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    private readonly riderGateway: RiderGateway,
  ) {}

  async handle(event: OrderStatusChangedEvent) {
    const order = await this.ordersRepository.findOne({
      where: { id: event.orderId },
      relations: ['rider'],
    });
    if (!order) return;

    const wasAssigned = Boolean(order.riderId);
    const becameAssigned =
      wasAssigned && event.newStatus === OrderStatus.acknoledged;
    const becameClosed = [OrderStatus.cancelled, OrderStatus.rejected].includes(
      event.newStatus as OrderStatus,
    );

    // Support both the current Rider.id foreign key and older rows that stored
    // Rider.userId in riderId.
    const rider = order.riderId
      ? order.rider ||
        (await this.riderRepository.findOne({
          where: [{ id: order.riderId }, { userId: order.riderId }],
        }))
      : null;

    if (becameAssigned || becameClosed) {
      this.riderGateway.notifyOrderUnavailable(
        event.orderId,
        event.newStatus,
        wasAssigned,
        becameAssigned ? rider?.userId : undefined,
      );
    }

    if (!order.riderId) return;
    if (!rider?.userId) return;

    this.riderGateway.notifyOrderStatusUpdate(
      rider.userId,
      event.orderId,
      event.newStatus,
    );
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Orders } from '../model/order.entity';
import { OrderStatus } from '../model/enum/order-status.enum';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { Rider } from '../../riders/model/rider.entity';
import { OrdersService } from '../services/orders.service';

@Injectable()
export class GetActiveDeliveryUseCase {
  constructor(
    @InjectRepository(Orders)
    private readonly ordersRepository: Repository<Orders>,
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    private readonly commonService: CommonService,
    private readonly ordersService: OrdersService,
  ) {}

  async execute(): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();

    const rider = await this.riderRepository.findOne({
      where: { userId: authenticatedUser.id },
    });

    if (!rider) {
      return new StandardResponse(false, 'NO_ACTIVE_DELIVERY', null);
    }

    const activeOrder = await this.ordersRepository.findOne({
      where: [
        {
          riderId: rider.id,
          cancelledAt: IsNull(),
          deliveredAt: IsNull(),
          rejectedAt: IsNull(),
          status: In([
            OrderStatus.acknoledged,
            OrderStatus.picked_up,
            OrderStatus.in_transit,
          ]),
        },
        {
          riderId: rider.userId,
          cancelledAt: IsNull(),
          deliveredAt: IsNull(),
          rejectedAt: IsNull(),
          status: In([
            OrderStatus.acknoledged,
            OrderStatus.picked_up,
            OrderStatus.in_transit,
          ]),
        },
      ],
      relations: ['orderTracking'],
      order: { updatedAt: 'DESC' },
    });

    const latestTracking = activeOrder?.orderTracking?.reduce(
      (latest, tracking) =>
        !latest || tracking.createdAt > latest.createdAt ? tracking : latest,
      undefined,
    );
    const activeStatuses = new Set<OrderStatus>([
      OrderStatus.acknoledged,
      OrderStatus.picked_up,
      OrderStatus.in_transit,
    ]);

    // The tracking history is the final safeguard for legacy/inconsistent
    // rows whose Orders.status was not updated when cancellation was recorded.
    if (
      !activeOrder ||
      (latestTracking && !activeStatuses.has(latestTracking.orderStatus))
    ) {
      return new StandardResponse(false, 'NO_ACTIVE_DELIVERY', null);
    }

    return await this.ordersService.findById(activeOrder.id);
  }
}

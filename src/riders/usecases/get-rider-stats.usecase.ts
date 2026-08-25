import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rider } from '../model/rider.entity';
import { Orders } from 'src/orders/model/order.entity';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { OrderStatus } from 'src/orders/model/enum/order-status.enum';
import { calculateRiderCommission } from '../rider-commission';
import moment from 'moment-timezone';

@Injectable()
export class GetRiderStatsUseCase {
  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    @InjectRepository(Orders)
    private readonly orderRepository: Repository<Orders>,
    private readonly commonService: CommonService,
  ) {}

  async execute(riderId: string): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();

    const rider = await this.riderRepository.findOne({
      where: { id: riderId, userId: authenticatedUser.id },
    });

    if (!rider) {
      throw new NotFoundException(
        new StandardResponse(true, 'RIDER_NOT_FOUND'),
      );
    }

    // Fetch all orders assigned to this rider
    const orders = await this.orderRepository.find({
      where: { riderId: rider.id },
      relations: ['orderCharges', 'orderCharges.chargeNodes'],
    });

    const completedOrders = orders.filter(
      (o) => o.status === OrderStatus.delivered,
    );

    const getDeliveryFee = (order: Orders) => {
      let fee = 0;
      if (order.orderCharges?.chargeNodes) {
        const node = order.orderCharges.chargeNodes.find(
          (n) => n.name === 'deliveryFee',
        );
        fee = node ? Number(node.amount) : 0;
      }
      return fee;
    };

    const getNetEarning = (order: Orders) =>
      calculateRiderCommission(getDeliveryFee(order)).netRiderPayout;
    const deliveredAt = (order: Orders) =>
      new Date(order.deliveredAt || order.updatedAt || order.createdAt);

    const totalEarnings = completedOrders.reduce(
      (sum, o) => sum + getNetEarning(o),
      0,
    );
    const totalDeliveries = completedOrders.length;

    const completionRate =
      orders.length > 0
        ? Math.round((completedOrders.length / orders.length) * 100)
        : 100;

    const now = new Date();
    const startOfToday = moment.tz('Africa/Lagos').startOf('day').toDate();
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const todayOrders = completedOrders.filter(
      (o) => deliveredAt(o) >= startOfToday,
    );
    const weeklyOrders = completedOrders.filter(
      (o) => deliveredAt(o) >= startOfWeek,
    );
    const monthlyOrders = completedOrders.filter(
      (o) => deliveredAt(o) >= startOfMonth,
    );

    const todayDeliveries = todayOrders.length;
    const todayEarnings = todayOrders.reduce(
      (sum, o) => sum + getNetEarning(o),
      0,
    );
    const weeklyEarnings = weeklyOrders.reduce(
      (sum, o) => sum + getNetEarning(o),
      0,
    );
    const monthlyEarnings = monthlyOrders.reduce(
      (sum, o) => sum + getNetEarning(o),
      0,
    );

    // Calculate additional stats
    const stats = {
      rating: Number(rider.rating) || 0,
      totalDeliveries,
      totalEarnings: Number(totalEarnings.toFixed(2)),
      acceptanceRate: Number(rider.acceptanceRate) || 0,
      completionRate: completionRate,
      onlineHours: rider.onlineHours || 0,
      todayDeliveries,
      todayEarnings,
      weeklyEarnings,
      monthlyEarnings,
    };

    return new StandardResponse(false, 'RIDER_STATS_FETCHED', stats);
  }
}

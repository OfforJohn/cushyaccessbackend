import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rider } from '../model/rider.entity';
import { Orders } from 'src/orders/model/order.entity';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { OrderStatus } from 'src/orders/model/enum/order-status.enum';

@Injectable()
export class GetRiderOrderHistoryUseCase {
  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    @InjectRepository(Orders)
    private readonly orderRepository: Repository<Orders>,
    private readonly commonService: CommonService,
  ) {}

  async execute(): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const rider = await this.riderRepository.findOne({
      where: { userId: authenticatedUser.id },
    });

    if (!rider) {
      throw new NotFoundException(
        new StandardResponse(true, 'RIDER_NOT_FOUND'),
      );
    }

    const orders = await this.orderRepository.find({
      where: {
        riderId: rider.id,
      },
      relations: [
        'store',
        'orderItems',
        'pickUpLocation',
        'dropOffLocation',
        'orderCharges',
        'orderCharges.chargeNodes',
      ],
      order: {
        createdAt: 'DESC',
      },
    });

    // Format orders for history view
    const formattedOrders = orders.map(order => {
      let deliveryFee = 0;
      if (order.orderCharges?.chargeNodes) {
        const feeNode = order.orderCharges.chargeNodes.find(node => node.name === 'deliveryFee');
        deliveryFee = feeNode ? Number(feeNode.amount) : 0;
      }
      const calculatedFee = deliveryFee || Number(order.Charges) || (Number(order.totalAmount) - Number(order.totalAmountBeforeCharges)) || 0;

      return {
        id: order.id,
        type: order.type === 'Q_COMMERCE' ? 'Food & Grocery' : 'Logistics',
        date: order.createdAt?.toISOString(),
        amount: calculatedFee,
        status: order.status === OrderStatus.delivered ? 'Completed' : 'Cancelled',
        pickup: order.store?.name || order.pickUpLocationAddress || order.pickUpLocation?.address || 'Pickup Point',
        dropoff: order.dropOffLocationAddress || order.dropOffLocation?.address || 'Dropoff Point',
        icon: order.type === 'Q_COMMERCE' ? 'food' : 'package-variant',
      };
    });

    return new StandardResponse(
      false,
      'RIDER_ORDER_HISTORY_FETCHED',
      formattedOrders,
    );
  }
}

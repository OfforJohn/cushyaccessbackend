import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Orders } from 'src/orders/model/order.entity';
import { Rider } from 'src/riders/model/rider.entity';
import { StandardResponse } from 'src/common/module/standard-response';
import { OrderStatus } from 'src/orders/model/enum/order-status.enum';
import {
  calculateRiderCommission,
  RIDER_NET_PAYOUT_RATE,
  RIDER_PLATFORM_COMMISSION_RATE,
} from 'src/riders/rider-commission';

@Injectable()
export class RiderEarningsUseCase {
  constructor(
    @InjectRepository(Orders) private ordersRepository: Repository<Orders>,
    @InjectRepository(Rider) private riderRepository: Repository<Rider>,
  ) {}

  /**
   * Get earnings for a specific rider
   */
  async getRiderEarnings(
    riderId: string,
    startDate?: string,
    endDate?: string,
  ) {
    // Find the rider
    const rider = await this.riderRepository.findOne({
      where: { id: riderId },
      relations: ['user'],
    });
    if (!rider) {
      return new StandardResponse(true, 'RIDER_NOT_FOUND', null);
    }

    // Build query for delivered orders assigned to this rider
    const queryBuilder = this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.store', 'store')
      .leftJoinAndSelect('order.orderCharges', 'orderCharges')
      .leftJoinAndSelect('orderCharges.chargeNodes', 'chargeNodes')
      .innerJoin(
        'order.orderTracking',
        'deliveredTracking',
        'deliveredTracking.orderStatus = :status',
        { status: OrderStatus.delivered },
      )
      .where('order.riderId = :riderId', { riderId })
      .distinct(true);

    // Date filters
    if (startDate) {
      queryBuilder.andWhere('order.createdAt >= :startDate', {
        startDate: this.parseDate(startDate, 'startDate'),
      });
    }
    if (endDate) {
      queryBuilder.andWhere('order.createdAt < :endDate', {
        endDate: this.parseEndDate(endDate),
      });
    }

    const orders = await queryBuilder
      .orderBy('order.createdAt', 'DESC')
      .getMany();

    // Calculate earnings from each order
    const earningsDetails = orders.map((order) => {
      const deliveryFee = this.extractDeliveryFee(order);
      const { platformCommission, netRiderPayout } =
        calculateRiderCommission(deliveryFee);

      return {
        orderId: order.id,
        storeName: order.store?.name || 'Unknown',
        orderDate: order.createdAt,
        deliveryFee,
        platformCommission,
        riderEarning: netRiderPayout,
        dropOffAddress: order.dropOffLocationAddress,
      };
    });

    const totalDeliveryFees = earningsDetails.reduce(
      (sum, e) => sum + e.deliveryFee,
      0,
    );
    const totalRiderEarnings = earningsDetails.reduce(
      (sum, e) => sum + e.riderEarning,
      0,
    );

    return new StandardResponse(false, 'RIDER_EARNINGS_FETCHED', {
      rider: {
        id: rider.id,
        name: rider.user.firstName + ' ' + rider.user.lastName,
        phone: rider.user.mobile,
        email: rider.user.email,
      },
      summary: {
        totalDeliveries: orders.length,
        totalDeliveryFees: Number(totalDeliveryFees.toFixed(2)),
        totalRiderEarnings: Number(totalRiderEarnings.toFixed(2)),
        platformCommissionPercentage: RIDER_PLATFORM_COMMISSION_RATE * 100,
        earningPercentage: RIDER_NET_PAYOUT_RATE * 100,
      },
      earnings: earningsDetails,
    });
  }

  /**
   * Get earnings summary for all riders
   */
  async getRiderEarningsSummary(startDate?: string, endDate?: string) {
    // Get all riders
    const riders = await this.riderRepository.find({ relations: ['user'] });

    // Build query for all delivered orders
    const queryBuilder = this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.orderCharges', 'orderCharges')
      .leftJoinAndSelect('orderCharges.chargeNodes', 'chargeNodes')
      .innerJoin(
        'order.orderTracking',
        'deliveredTracking',
        'deliveredTracking.orderStatus = :status',
        { status: OrderStatus.delivered },
      )
      .where('order.riderId IS NOT NULL')
      .distinct(true);

    // Date filters
    if (startDate) {
      queryBuilder.andWhere('order.createdAt >= :startDate', {
        startDate: this.parseDate(startDate, 'startDate'),
      });
    }
    if (endDate) {
      queryBuilder.andWhere('order.createdAt < :endDate', {
        endDate: this.parseEndDate(endDate),
      });
    }

    const orders = await queryBuilder.getMany();

    // Group by rider
    const riderEarningsMap = new Map<
      string,
      {
        riderId: string;
        riderName: string;
        totalDeliveries: number;
        totalDeliveryFees: number;
        totalEarnings: number;
      }
    >();

    // Initialize map with all riders
    for (const rider of riders) {
      riderEarningsMap.set(rider.id, {
        riderId: rider.id,
        riderName: rider.user.firstName + ' ' + rider.user.lastName,
        totalDeliveries: 0,
        totalDeliveryFees: 0,
        totalEarnings: 0,
      });
    }

    const ridersById = new Map(riders.map((rider) => [rider.id, rider]));

    // Calculate earnings
    for (const order of orders) {
      const riderId = order.riderId;
      const deliveryFee = this.extractDeliveryFee(order);
      const riderEarning = calculateRiderCommission(deliveryFee).netRiderPayout;

      // Find rider in our map or in the riders list
      const rider = ridersById.get(riderId);
      if (rider) {
        const existing = riderEarningsMap.get(rider.id) || {
          riderId: rider.id,
          riderName: rider.user.firstName + ' ' + rider.user.lastName,
          totalDeliveries: 0,
          totalDeliveryFees: 0,
          totalEarnings: 0,
        };

        existing.totalDeliveries += 1;
        existing.totalDeliveryFees += deliveryFee;
        existing.totalEarnings += riderEarning;
        riderEarningsMap.set(rider.id, existing);
      }
    }

    // Convert to array and format
    const ridersSummary = Array.from(riderEarningsMap.values())
      .map((r) => ({
        ...r,
        totalDeliveryFees: Number(r.totalDeliveryFees.toFixed(2)),
        totalEarnings: Number(r.totalEarnings.toFixed(2)),
      }))
      .sort((a, b) => b.totalEarnings - a.totalEarnings);

    // Overall totals
    const overallTotals = {
      totalRiders: riders.length,
      totalDeliveries: orders.length,
      totalDeliveryFees: Number(
        ridersSummary
          .reduce((sum, r) => sum + r.totalDeliveryFees, 0)
          .toFixed(2),
      ),
      totalRiderEarnings: Number(
        ridersSummary.reduce((sum, r) => sum + r.totalEarnings, 0).toFixed(2),
      ),
      platformCommissionPercentage: RIDER_PLATFORM_COMMISSION_RATE * 100,
      earningPercentage: RIDER_NET_PAYOUT_RATE * 100,
    };

    return new StandardResponse(false, 'RIDER_EARNINGS_SUMMARY_FETCHED', {
      overall: overallTotals,
      riders: ridersSummary,
    });
  }

  // Extract delivery fee from order's charge nodes
  private extractDeliveryFee(order: Orders): number {
    const chargeNodes = order.orderCharges?.chargeNodes;
    if (!chargeNodes || !Array.isArray(chargeNodes)) {
      return 0;
    }

    // Find the delivery fee charge node
    const deliveryCharge = chargeNodes.find(
      (node) => node?.name === 'deliveryFee',
    );

    return Number(deliveryCharge?.amount || 0);
  }

  private parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid date`);
    }
    return date;
  }

  private parseEndDate(value: string): Date {
    const date = this.parseDate(value, 'endDate');
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      date.setUTCDate(date.getUTCDate() + 1);
    } else {
      date.setMilliseconds(date.getMilliseconds() + 1);
    }
    return date;
  }
}

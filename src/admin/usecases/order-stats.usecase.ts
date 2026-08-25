import { Between, In, Repository } from 'typeorm';
import { StandardResponse } from '../../common/module/standard-response';
import { Injectable } from '@nestjs/common';
import { Orders } from 'src/orders/model/order.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { OrderStatus } from 'src/orders/model/enum/order-status.enum';

@Injectable()
export class OrderStatsUseCase {
  constructor(
    @InjectRepository(Orders) private ordersRepository: Repository<Orders>,
  ) {}

  async execute(from: Date, to: Date): Promise<StandardResponse> {
    const statusFilter = In([
        OrderStatus.pending,
        OrderStatus.picked_up,
        OrderStatus.delivered,
    ]);

    // Get orders in the date range and with desired statuses
    const orders = await this.ordersRepository.find({
        where: {
        createdAt: Between(from, to),
        orderTracking: {
            orderStatus: statusFilter,
        },
        },
        relations: ['orderTracking'],
    });

    // Total orders count
    const totalOrders = orders.length;

    // Total sales amount (including charges)
    const totalSalesAmount = orders.reduce(
        (acc, order) => acc + Number(order.totalAmount || 0),
        0,
    );

    // Total vendor revenue (before charges)
    const totalVendorRevenueAmount = orders.reduce(
        (acc, order) => acc + Number(order.totalAmountBeforeCharges || 0),
        0,
    );

    // Total rider revenue (currently set to 0, adjust as needed)
    const riderOrders = orders.filter((order) =>
        [OrderStatus.picked_up, OrderStatus.delivered].includes(
        order.orderTracking[0]?.orderStatus,
        ),
    );

    const totalRiderRevenueAmount = riderOrders.reduce((acc, _) => acc + 0, 0); // Modify if rider revenue is stored somewhere

    return new StandardResponse(false, 'ORDERS_STATS_FETCHED_SUCCESSFULLY', {
        totalOrders,
        totalVendorRevenue: parseFloat(totalVendorRevenueAmount.toFixed(2)),
        totalRiderRevenue: parseFloat(totalRiderRevenueAmount.toFixed(2)),
        totalSalesAmount: parseFloat(totalSalesAmount.toFixed(2)),
    });
    }
}

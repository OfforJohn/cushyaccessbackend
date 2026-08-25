import { Between, In, Repository } from 'typeorm';
import { StandardResponse } from '../../common/module/standard-response';
import { Injectable } from '@nestjs/common';
import { Orders } from 'src/orders/model/order.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { OrderStatus } from 'src/orders/model/enum/order-status.enum';
import { endOfYear, format, startOfYear } from 'date-fns';

@Injectable()
export class OrderGraphUseCase {
  constructor(
    @InjectRepository(Orders) private ordersRepository: Repository<Orders>,
  ) {}

  async execute(year: number): Promise<StandardResponse> {
    const from = startOfYear(new Date(year, 0, 1));
    const to = endOfYear(new Date(year, 11, 31));

    const orders = await this.ordersRepository.find({
        where: {
        createdAt: Between(from, to),
        orderTracking: {
            orderStatus: In([
            OrderStatus.pending,
            OrderStatus.picked_up,
            OrderStatus.delivered,
            ]),
        },
        },
        relations: ['orderTracking'],
    });

    const revenueByMonth: Record<string, number> = {};

    for (const order of orders) {
        const monthName = format(order.createdAt, 'MMMM'); // e.g., January, February
        const revenue = Number(order.totalAmount || 0);
        revenueByMonth[monthName] = (revenueByMonth[monthName] || 0) + revenue;
    }

    // Create array for all 12 months to ensure consistent output
    const allMonths = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
    ];

    const salesGraph = allMonths.map((month) => ({
        month,
        totalRevenue: parseFloat((revenueByMonth[month] || 0).toFixed(2)),
    }));

    return new StandardResponse(false, 'SALES_GRAPH_FETCHED_SUCCESSFULLY', salesGraph);
  }
}

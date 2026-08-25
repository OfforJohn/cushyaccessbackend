import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StandardResponse } from '../../common/module/standard-response';
import { OrderStatus } from '../../orders/model/enum/order-status.enum';
import { Orders } from '../../orders/model/order.entity';
import { Rider, RiderStatus } from '../../riders/model/rider.entity';
import { getRiderOrderOfferConfig } from '../../riders/rider-order-offer.config';

const ACTIVE_STATUSES = [
  OrderStatus.acknoledged,
  OrderStatus.picked_up,
  OrderStatus.in_transit,
];

@Injectable()
export class LogisticsOverviewUseCase {
  constructor(
    @InjectRepository(Orders)
    private readonly ordersRepository: Repository<Orders>,
    @InjectRepository(Rider)
    private readonly ridersRepository: Repository<Rider>,
  ) {}

  async execute(page = 1, size = 50, location = 'all') {
    const safePage = Math.max(1, Math.trunc(Number(page) || 1));
    const safeSize = Math.min(100, Math.max(1, Math.trunc(Number(size) || 50)));
    const locationQuery = location?.trim().toLowerCase();
    const { maxLocationAgeMinutes } = getRiderOrderOfferConfig();
    const locationFreshSince = new Date(
      Date.now() - maxLocationAgeMinutes * 60_000,
    );
    const onlineRidersQuery = this.ridersRepository
      .createQueryBuilder('rider')
      .where('rider.isOnline = true')
      .andWhere('rider.status = :activeRiderStatus', {
        activeRiderStatus: RiderStatus.ACTIVE,
      })
      .andWhere('rider.lastLocationUpdate >= :locationFreshSince', {
        locationFreshSince,
      });

    const jobsQuery = this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.rider', 'rider')
      .where('order.riderId IS NOT NULL')
      .andWhere('order.status IN (:...activeStatuses)', {
        activeStatuses: ACTIVE_STATUSES,
      });
    const terminalQuery = this.ordersRepository
      .createQueryBuilder('order')
      .where('order.riderId IS NOT NULL')
      .andWhere('order.status IN (:...terminalStatuses)', {
        terminalStatuses: [
          OrderStatus.delivered,
          OrderStatus.cancelled,
          OrderStatus.rejected,
        ],
      });

    if (locationQuery && locationQuery !== 'all') {
      const addressFilter =
        "LOWER(COALESCE(order.dropOffLocationAddress, order.fullHouseAddress, '')) LIKE :location";
      const parameters = { location: `%${locationQuery}%` };
      jobsQuery.andWhere(addressFilter, parameters);
      terminalQuery.andWhere(addressFilter, parameters);
    }

    const deliveredQuery = terminalQuery
      .clone()
      .andWhere('order.status = :delivered', {
        delivered: OrderStatus.delivered,
      });
    const durationQuery = deliveredQuery
      .clone()
      .andWhere('order.pickedUpAt IS NOT NULL')
      .andWhere('order.deliveredAt IS NOT NULL')
      .select(
        'AVG(EXTRACT(EPOCH FROM (order.deliveredAt - order.pickedUpAt)) / 60)',
        'averageMinutes',
      );

    const [
      onlineRiders,
      activeJobCount,
      terminalCount,
      deliveredCount,
      duration,
      activeRiders,
      jobs,
    ] = await Promise.all([
      onlineRidersQuery.getCount(),
      jobsQuery.clone().getCount(),
      terminalQuery.getCount(),
      deliveredQuery.getCount(),
      durationQuery.getRawOne<{ averageMinutes: string | null }>(),
      jobsQuery
        .clone()
        .select('DISTINCT order.riderId', 'riderId')
        .getRawMany<{ riderId: string }>(),
      jobsQuery
        .orderBy('order.riderAcceptedAt', 'DESC', 'NULLS LAST')
        .addOrderBy('order.createdAt', 'DESC')
        .skip((safePage - 1) * safeSize)
        .take(safeSize)
        .getMany(),
    ]);

    return new StandardResponse(false, 'LOGISTICS_OVERVIEW_FETCHED', {
      metrics: {
        onlineRiders,
        onlineRidersScope: 'global',
        activeJobs: activeJobCount,
        averageDeliveryMinutes:
          duration?.averageMinutes == null
            ? null
            : Math.round(Number(duration.averageMinutes)),
        successRate:
          terminalCount === 0
            ? null
            : Math.round((deliveredCount / terminalCount) * 100),
      },
      jobs,
      activeRiderIds: activeRiders.map((row) => row.riderId),
      pagination: {
        page: safePage,
        size: safeSize,
        total: activeJobCount,
        pageCount: Math.ceil(activeJobCount / safeSize),
      },
    });
  }
}

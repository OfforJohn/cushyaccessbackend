import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommonService } from '../../common/common.service';
import { StandardResponse } from '../../common/module/standard-response';
import { Orders } from '../../orders/model/order.entity';
import { Rider } from '../model/rider.entity';
import { getRiderOrderOfferConfig } from '../rider-order-offer.config';

type NearbyOrder = Orders & {
  pickUpLocation?: {
    id?: string;
    latitude?: string | number;
    longitude?: string | number;
  };
};

@Injectable()
export class GetHotspotsUseCase {
  constructor(
    @InjectRepository(Orders)
    private readonly ordersRepository: Repository<Orders>,
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    private readonly commonService: CommonService,
  ) {}

  private formatHour(hour: number): string {
    const normalized = hour % 24;
    if (normalized === 0) return '12AM';
    if (normalized === 12) return '12PM';
    return normalized > 12 ? `${normalized - 12}PM` : `${normalized}AM`;
  }

  private coordinate(value: unknown, min: number, max: number): number | null {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max
      ? parsed
      : null;
  }

  private async getNearbyOrders(
    latitude: number,
    longitude: number,
    since: Date,
    limit: number,
  ): Promise<NearbyOrder[]> {
    const pickupLatitude = `CASE WHEN "pickup"."latitude" ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN CAST("pickup"."latitude" AS double precision) ELSE NULL END`;
    const pickupLongitude = `CASE WHEN "pickup"."longitude" ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN CAST("pickup"."longitude" AS double precision) ELSE NULL END`;
    const { radiusKm } = getRiderOrderOfferConfig();

    return this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.store', 'store')
      .innerJoinAndSelect('order.pickUpLocation', 'pickup')
      .where('order.createdAt >= :since', { since })
      .andWhere(`order.status NOT IN (:...excludedStatuses)`, {
        excludedStatuses: ['CANCELLED', 'REJECTED'],
      })
      .andWhere(`${pickupLatitude} BETWEEN -90 AND 90`)
      .andWhere(`${pickupLongitude} BETWEEN -180 AND 180`)
      .andWhere(
        `ST_DWithin(ST_MakePoint(${pickupLongitude}, ${pickupLatitude})::geography, ST_MakePoint(:riderLongitude, :riderLatitude)::geography, :radiusMeters)`,
        {
          riderLatitude: latitude,
          riderLongitude: longitude,
          radiusMeters: radiusKm * 1000,
        },
      )
      .orderBy('order.createdAt', 'DESC')
      .take(limit)
      .getMany();
  }

  async execute(): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const rider = await this.riderRepository.findOne({
      where: { userId: authenticatedUser.id },
      select: {
        id: true,
        userId: true,
        currentLatitude: true,
        currentLongitude: true,
        lastLocationUpdate: true,
      },
    });
    const latitude = this.coordinate(rider?.currentLatitude, -90, 90);
    const longitude = this.coordinate(rider?.currentLongitude, -180, 180);
    const { radiusKm, maxLocationAgeMinutes } = getRiderOrderOfferConfig();
    const locationAge = rider?.lastLocationUpdate
      ? Date.now() - new Date(rider.lastLocationUpdate).getTime()
      : Number.POSITIVE_INFINITY;

    if (
      latitude == null ||
      longitude == null ||
      !Number.isFinite(locationAge) ||
      locationAge > maxLocationAgeMinutes * 60_000
    ) {
      return new StandardResponse(false, 'HOTSPOTS_FETCHED', {
        hotspots: [],
        peakHoursTip:
          'Refresh your location to see demand close to where you are now.',
        radiusKm,
        locationStatus: 'unavailable',
      });
    }

    const now = Date.now();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const localHistory = await this.getNearbyOrders(
      latitude,
      longitude,
      thirtyDaysAgo,
      2000,
    );
    const recentOrders = localHistory.filter(
      (order) => new Date(order.createdAt).getTime() >= twoHoursAgo.getTime(),
    );
    const grouped = new Map<
      string,
      {
        id?: string;
        name: string;
        count: number;
        latitude: number;
        longitude: number;
      }
    >();

    for (const order of recentOrders) {
      const pickupLatitude = this.coordinate(
        order.pickUpLocation?.latitude,
        -90,
        90,
      );
      const pickupLongitude = this.coordinate(
        order.pickUpLocation?.longitude,
        -180,
        180,
      );
      const name = order.pickUpLocationAddress?.trim() || order.store?.name;
      if (pickupLatitude == null || pickupLongitude == null || !name) continue;
      const key =
        order.pickUpLocation?.id || `${pickupLatitude}:${pickupLongitude}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        grouped.set(key, {
          id: order.pickUpLocation?.id,
          name,
          count: 1,
          latitude: pickupLatitude,
          longitude: pickupLongitude,
        });
      }
    }

    const hotspots = [...grouped.values()]
      .map((hotspot) => ({
        ...hotspot,
        demand:
          hotspot.count >= 10
            ? 'High demand'
            : hotspot.count >= 5
              ? 'Medium demand'
              : 'Low demand',
        demandLevel:
          hotspot.count >= 10
            ? ('high' as const)
            : hotspot.count >= 5
              ? ('medium' as const)
              : ('low' as const),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const hourlyCounts = new Array<number>(24).fill(0);
    for (const order of localHistory) {
      if (order.createdAt)
        hourlyCounts[new Date(order.createdAt).getHours()] += 1;
    }
    const peakStart = hourlyCounts.reduce(
      (best, _count, hour) =>
        hourlyCounts[hour] + hourlyCounts[(hour + 1) % 24] >
        hourlyCounts[best] + hourlyCounts[(best + 1) % 24]
          ? hour
          : best,
      0,
    );
    const hasLocalHistory = localHistory.length > 0;
    const peakHoursTip = hasLocalHistory
      ? `${this.formatHour(peakStart)}–${this.formatHour(
          peakStart + 2,
        )} has historically had the most orders within ${radiusKm} km of your current location.`
      : `No recent order-demand pattern is available within ${radiusKm} km of your current location.`;

    return new StandardResponse(false, 'HOTSPOTS_FETCHED', {
      hotspots,
      peakHoursTip,
      radiusKm,
      locationStatus: 'fresh',
    });
  }
}

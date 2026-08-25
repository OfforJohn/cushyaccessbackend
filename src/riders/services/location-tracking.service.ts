import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThan, LessThan, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RiderLocationHistory } from '../model/rider-location-history.entity';
import { Rider } from '../model/rider.entity';
import { EventBus } from '@nestjs/cqrs';

@Injectable()
export class LocationTrackingService {
  private readonly logger = new Logger(LocationTrackingService.name);

  constructor(
    @InjectRepository(RiderLocationHistory)
    private readonly locationHistoryRepo: Repository<RiderLocationHistory>,
    
    @InjectRepository(Rider)
    private readonly riderRepo: Repository<Rider>,
    
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Save location history with PostGIS point
   */
  async saveLocation(
    riderId: string,
    locationData: {
      latitude: number;
      longitude: number;
      accuracy?: number;
      altitude?: number;
      speed?: number;
      heading?: number;
      tripId?: string;
      batteryLevel?: number;
    },
  ): Promise<RiderLocationHistory> {
    const history = new RiderLocationHistory();
    history.riderId = riderId;
    history.latitude = locationData.latitude;
    history.longitude = locationData.longitude;
    history.accuracy = locationData.accuracy;
    history.altitude = locationData.altitude;
    history.speed = locationData.speed;
    history.heading = locationData.heading;
    history.tripId = locationData.tripId;
    history.timestamp = new Date();
    history.metadata = {
      batteryLevel: locationData.batteryLevel,
    };

    // Create PostGIS point
    history.location = {
      type: 'Point',
      coordinates: [locationData.longitude, locationData.latitude],
    };

    return await this.locationHistoryRepo.save(history);
  }

  /**
   * Get rider's location history for a time range
   */
  async getLocationHistory(
    riderId: string,
    startDate: Date,
    endDate: Date,
    limit: number = 1000,
  ): Promise<RiderLocationHistory[]> {
    return await this.locationHistoryRepo.find({
      where: {
        riderId,
        timestamp: Between(startDate, endDate),
      },
      order: {
        timestamp: 'ASC',
      },
      take: limit,
    });
  }

  /**
   * Get rider's last known location
   */
  async getLastLocation(riderId: string): Promise<RiderLocationHistory | null> {
    return await this.locationHistoryRepo.findOne({
      where: { riderId },
      order: { timestamp: 'DESC' },
    });
  }

  /**
   * Get location history for a specific trip
   */
  async getTripRoute(tripId: string): Promise<RiderLocationHistory[]> {
    return await this.locationHistoryRepo.find({
      where: { tripId },
      order: { timestamp: 'ASC' },
    });
  }

  /**
   * Calculate distance traveled during a trip
   */
  async calculateTripDistance(tripId: string): Promise<number> {
    const locations = await this.getTripRoute(tripId);
    
    if (locations.length < 2) {
      return 0;
    }

    let totalDistance = 0;
    for (let i = 1; i < locations.length; i++) {
      totalDistance += this.calculateDistance(
        locations[i-1].latitude,
        locations[i-1].longitude,
        locations[i].latitude,
        locations[i].longitude,
      );
    }

    return Math.round(totalDistance * 100) / 100; // in meters
  }

  /**
   * Find nearby riders using PostGIS
   */
  async findNearbyRidersPostGIS(
    latitude: number,
    longitude: number,
    radiusInMeters: number = 5000,
    excludeRiderId?: string,
  ): Promise<any[]> {
    const query = `
      SELECT DISTINCT ON (r.id)
        r.id as "riderId",
        r."bikeType",
        r."bikeColor",
        r."licensePlate",
        r.rating,
        r."totalDeliveries",
        r."profilePhoto",
        u."firstName" as "firstName",
        u."lastName" as "lastName",
        ST_X(l.location::geometry) as longitude,
        ST_Y(l.location::geometry) as latitude,
        ST_Distance(
          l.location::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) as distance,
        l.timestamp as "lastUpdate"
      FROM riders r
      JOIN users u ON r."userId" = u.id
      JOIN rider_location_history l ON r.id = l."riderId"
      WHERE 
        r."isOnline" = true 
        AND r.status = 'active'
        AND l.timestamp = (
          SELECT MAX(timestamp)
          FROM rider_location_history
          WHERE "riderId" = r.id
        )
        AND ST_DWithin(
          l.location::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3
        )
        ${excludeRiderId ? 'AND r.id != $4' : ''}
      ORDER BY r.id, distance
      LIMIT 50
    `;

    const params = excludeRiderId 
      ? [longitude, latitude, radiusInMeters, excludeRiderId]
      : [longitude, latitude, radiusInMeters];

    return await this.locationHistoryRepo.query(query, params);
  }

  /**
   * Get heatmap data for admin dashboard
   */
  async getHeatmapData(
    bounds: {
      north: number;
      south: number;
      east: number;
      west: number;
    },
    timeRange: 'hour' | 'day' | 'week' = 'hour',
  ): Promise<any[]> {
    let timeFilter: Date;
    const now = new Date();

    switch (timeRange) {
      case 'hour':
        timeFilter = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case 'day':
        timeFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        timeFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
    }

    const query = `
      SELECT 
        ST_X(location::geometry) as longitude,
        ST_Y(location::geometry) as latitude,
        COUNT(*) as intensity,
        AVG(r.rating) as avg_rating
      FROM rider_location_history l
      JOIN riders r ON l."riderId" = r.id
      WHERE 
        l.timestamp > $1
        AND ST_Within(
          location::geometry,
          ST_MakeEnvelope($2, $3, $4, $5, 4326)
        )
      GROUP BY ST_X(location::geometry), ST_Y(location::geometry)
      HAVING COUNT(*) > 1
    `;

    return await this.locationHistoryRepo.query(query, [
      timeFilter,
      bounds.west,
      bounds.south,
      bounds.east,
      bounds.north,
    ]);
  }

  /**
   * Clean up old location history (runs daily at 2 AM)
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupOldLocations() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await this.locationHistoryRepo.delete({
      timestamp: LessThan(thirtyDaysAgo),
    });

    this.logger.log(`Cleaned up ${result.affected} old location records`);
  }

  /**
   * Archive location history to cold storage
   */
  async archiveLocations(beforeDate: Date): Promise<number> {
    // This would typically move data to a data warehouse or archive table
    // For now, just log the count
    const count = await this.locationHistoryRepo.count({
      where: { timestamp: LessThan(beforeDate) },
    });

    this.logger.log(`Found ${count} records to archive before ${beforeDate}`);
    
    // TODO: Implement actual archiving logic
    
    return count;
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }
}
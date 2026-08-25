import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventBus } from '@nestjs/cqrs';
import { Rider, RiderStatus } from '../model/rider.entity';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { RiderLocationUpdatedEvent } from '../events/rider-location-updated.event';
import { getRiderOrderOfferConfig } from '../rider-order-offer.config';

export interface LocationUpdateDto {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  timestamp?: Date;
  batteryLevel?: number;
}

@Injectable()
export class UpdateRiderLocationUseCase {
  private readonly logger = new Logger(UpdateRiderLocationUseCase.name);

  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    private readonly commonService: CommonService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(
    riderId: string,
    locationData: LocationUpdateDto,
  ): Promise<StandardResponse> {
    // Get the authenticated user
    const authenticatedUser = await this.commonService.getLoggedInUser();

    // Validate location data
    this.validateLocationData(locationData);

    // Find the rider and verify ownership
    const rider = await this.riderRepository.findOne({
      where: { id: riderId, userId: authenticatedUser.id },
    });

    if (!rider) {
      throw new BadRequestException(
        new StandardResponse(true, 'RIDER_NOT_FOUND_OR_UNAUTHORIZED'),
      );
    }

    // Check if rider is active/online to update location
    if (!this.canUpdateLocation(rider)) {
      throw new BadRequestException(
        new StandardResponse(true, 'RIDER_NOT_ACTIVE_OR_ONLINE'),
      );
    }

    // Calculate distance from last location (if exists)
    const distanceMoved = this.calculateDistanceMoved(rider, locationData);

    // Freshness is security-sensitive for order targeting. Use server time so
    // a malformed or manipulated device timestamp cannot keep a rider eligible.
    const recordedAt = new Date();
    rider.currentLatitude = locationData.latitude;
    rider.currentLongitude = locationData.longitude;
    rider.currentLocation = `POINT(${locationData.longitude} ${locationData.latitude})`;
    rider.lastLocationUpdate = recordedAt;

    // Store additional metadata
    const metadata = rider.metadata || {};
    if (!metadata.locationHistory) {
      metadata.locationHistory = [];
    }

    // Keep last 10 locations for debugging
    metadata.locationHistory.push({
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      accuracy: locationData.accuracy,
      altitude: locationData.altitude,
      speed: locationData.speed,
      heading: locationData.heading,
      timestamp: rider.lastLocationUpdate,
      batteryLevel: locationData.batteryLevel,
    });

    if (metadata.locationHistory.length > 10) {
      metadata.locationHistory.shift();
    }

    // Update movement stats
    if (distanceMoved > 0) {
      metadata.totalDistanceMoved =
        (metadata.totalDistanceMoved || 0) + distanceMoved;
    }

    rider.metadata = metadata;

    // Update only location-owned columns. Saving the previously read Rider
    // entity could overwrite a concurrent clearance, online-state or earnings
    // update with stale values.
    const locationUpdate = await this.riderRepository.update(
      {
        id: rider.id,
        userId: authenticatedUser.id,
        isOnline: true,
        status: RiderStatus.ACTIVE,
      },
      {
        currentLatitude: rider.currentLatitude,
        currentLongitude: rider.currentLongitude,
        currentLocation: rider.currentLocation,
        lastLocationUpdate: recordedAt,
        metadata: rider.metadata,
      },
    );
    if (locationUpdate.affected !== 1) {
      throw new BadRequestException(
        new StandardResponse(true, 'RIDER_NOT_ACTIVE_OR_ONLINE'),
      );
    }

    // Publish location updated event for real-time tracking
    this.eventBus.publish(
      new RiderLocationUpdatedEvent(
        riderId,
        locationData.latitude,
        locationData.longitude,
        locationData.accuracy,
        locationData.altitude,
        locationData.speed,
        locationData.heading,
        recordedAt,
        locationData.batteryLevel,
      ),
    );

    // Prepare response with additional info
    const response = {
      riderId: rider.id,
      location: {
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        accuracy: locationData.accuracy,
        timestamp: rider.lastLocationUpdate,
      },
      stats: {
        distanceFromLast: distanceMoved > 0 ? distanceMoved : null,
        totalDistanceToday: await this.calculateTotalDistanceToday(rider),
        lastUpdate: rider.lastLocationUpdate,
      },
    };

    return new StandardResponse(
      false,
      'RIDER_LOCATION_UPDATED_SUCCESSFULLY',
      response,
    );
  }

  /**
   * Batch update multiple rider locations (for admin/websocket)
   */
  async batchUpdateLocations(
    locations: { riderId: string; location: LocationUpdateDto }[],
  ): Promise<void> {
    const updates = locations.map(async ({ riderId, location }) => {
      try {
        this.validateLocationData(location);
        const rider = await this.riderRepository.findOne({
          where: { id: riderId },
        });

        if (rider && this.canUpdateLocation(rider)) {
          const recordedAt = new Date();
          const update = await this.riderRepository.update(
            {
              id: rider.id,
              isOnline: true,
              status: RiderStatus.ACTIVE,
            },
            {
              currentLatitude: location.latitude,
              currentLongitude: location.longitude,
              currentLocation: `POINT(${location.longitude} ${location.latitude})`,
              lastLocationUpdate: recordedAt,
            },
          );
          if (update.affected !== 1) return;

          // Publish event for each update
          this.eventBus.publish(
            new RiderLocationUpdatedEvent(
              riderId,
              location.latitude,
              location.longitude,
              location.accuracy,
              location.altitude,
              location.speed,
              location.heading,
              recordedAt,
              location.batteryLevel,
            ),
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to update location for rider ${riderId}.`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    });

    await Promise.all(updates);
  }

  /**
   * Get riders near a specific location
   */
  async getNearbyRiders(
    latitude: number,
    longitude: number,
    radiusInKm: number = getRiderOrderOfferConfig().radiusKm,
  ): Promise<any[]> {
    // Using PostGIS for spatial query
    const query = `
      SELECT 
        r.id,
        r."userId",
        r."bikeType",
        r."bikeColor",
        r."licensePlate",
        r."rating",
        r."totalDeliveries",
        r."currentLatitude",
        r."currentLongitude",
        ST_Distance(
          ST_MakePoint($1, $2)::geography,
          ST_MakePoint(r."currentLongitude", r."currentLatitude")::geography
        ) as distance
      FROM riders r
      WHERE 
        r."isOnline" = true 
        AND r.status = 'active'
        AND r."currentLatitude" IS NOT NULL
        AND r."currentLongitude" IS NOT NULL
        AND ST_DWithin(
          ST_MakePoint($1, $2)::geography,
          ST_MakePoint(r."currentLongitude", r."currentLatitude")::geography,
          $3
        )
      ORDER BY distance
    `;

    const riders = await this.riderRepository.query(query, [
      longitude,
      latitude,
      radiusInKm * 1000, // Convert to meters
    ]);

    return riders.map((rider) => ({
      riderId: rider.id,
      location: {
        latitude: rider.currentLatitude,
        longitude: rider.currentLongitude,
      },
      distance: Math.round(rider.distance),
      bikeType: rider.bikeType,
      bikeColor: rider.bikeColor,
      licensePlate: rider.licensePlate,
      rating: rider.rating,
      deliveries: rider.totalDeliveries,
    }));
  }

  /**
   * Validate location data
   */
  private validateLocationData(locationData: LocationUpdateDto): void {
    // Check latitude range
    if (
      typeof locationData.latitude !== 'number' ||
      !Number.isFinite(locationData.latitude) ||
      locationData.latitude < -90 ||
      locationData.latitude > 90
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_LATITUDE'),
      );
    }

    // Check longitude range
    if (
      typeof locationData.longitude !== 'number' ||
      !Number.isFinite(locationData.longitude) ||
      locationData.longitude < -180 ||
      locationData.longitude > 180
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_LONGITUDE'),
      );
    }

    // Check accuracy if provided
    if (
      locationData.accuracy !== undefined &&
      (!Number.isFinite(locationData.accuracy) ||
        locationData.accuracy < 0 ||
        locationData.accuracy > 100_000)
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_ACCURACY'),
      );
    }

    // Check speed if provided
    if (
      locationData.speed !== undefined &&
      (!Number.isFinite(locationData.speed) ||
        locationData.speed < 0 ||
        locationData.speed > 200)
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_SPEED'),
      );
    }

    // Check heading if provided
    if (
      locationData.heading !== undefined &&
      (!Number.isFinite(locationData.heading) ||
        locationData.heading < 0 ||
        locationData.heading > 360)
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_HEADING'),
      );
    }

    // Check battery level if provided
    if (
      locationData.batteryLevel !== undefined &&
      (!Number.isFinite(locationData.batteryLevel) ||
        locationData.batteryLevel < 0 ||
        locationData.batteryLevel > 100)
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_BATTERY_LEVEL'),
      );
    }
  }

  /**
   * Check if rider can update location
   */
  private canUpdateLocation(rider: Rider): boolean {
    return rider.isOnline && rider.status === RiderStatus.ACTIVE;
  }

  /**
   * Calculate distance moved from last location
   */
  private calculateDistanceMoved(
    rider: Rider,
    newLocation: LocationUpdateDto,
  ): number {
    if (rider.currentLatitude == null || rider.currentLongitude == null) {
      return 0;
    }

    const R = 6371e3; // Earth's radius in meters
    const φ1 = (rider.currentLatitude * Math.PI) / 180;
    const φ2 = (newLocation.latitude * Math.PI) / 180;
    const Δφ = ((newLocation.latitude - rider.currentLatitude) * Math.PI) / 180;
    const Δλ =
      ((newLocation.longitude - rider.currentLongitude) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Calculate total distance traveled today
   */
  private async calculateTotalDistanceToday(rider: Rider): Promise<number> {
    const metadata = rider.metadata || {};
    const locationHistory = metadata.locationHistory || [];

    if (locationHistory.length < 2) {
      return 0;
    }

    let totalDistance = 0;
    for (let i = 1; i < locationHistory.length; i++) {
      const prev = locationHistory[i - 1];
      const curr = locationHistory[i];

      // Check if within same day
      const prevDate = new Date(prev.timestamp);
      const currDate = new Date(curr.timestamp);

      if (prevDate.toDateString() === currDate.toDateString()) {
        totalDistance += this.calculateDistanceBetweenPoints(
          prev.latitude,
          prev.longitude,
          curr.latitude,
          curr.longitude,
        );
      }
    }

    return Math.round(totalDistance);
  }

  /**
   * Calculate distance between two points
   */
  private calculateDistanceBetweenPoints(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Clean up stale locations (for cron job)
   */
  async cleanupStaleLocations(): Promise<number> {
    const staleThreshold = new Date();
    staleThreshold.setMinutes(staleThreshold.getMinutes() - 30); // 30 minutes threshold

    const result = await this.riderRepository
      .createQueryBuilder()
      .update(Rider)
      .set({
        isOnline: false,
        metadata: () =>
          "jsonb_set(metadata, '{offlineReason}', '\"location_timeout\"')",
      })
      .where('"isOnline" = true')
      .andWhere('"lastLocationUpdate" < :threshold', {
        threshold: staleThreshold,
      })
      .execute();

    return result.affected || 0;
  }
}

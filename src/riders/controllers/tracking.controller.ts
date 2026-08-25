import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Permit } from '../../auth/service/roles.decorator';
import { UserRoles } from '../../users/model/user-roles.enum';
import { LocationTrackingService } from '../services/location-tracking.service';
import { StandardResponse } from '../../common/module/standard-response';
import { RiderService } from '../services/riders.service';
import { SkipThrottle } from '@nestjs/throttler';
import { getRiderOrderOfferConfig } from '../rider-order-offer.config';

@SkipThrottle()
@Controller('api/v1/tracking')
export class TrackingController {
  constructor(
    private readonly locationTrackingService: LocationTrackingService,
    private readonly riderService: RiderService,
  ) {}

  @Get('nearby')
  @Permit([UserRoles.CUSTOMER, UserRoles.ADMIN])
  async getNearbyRiders(
    @Query('lat') latitude: string,
    @Query('lng') longitude: string,
    @Query('radius') radius?: string,
  ) {
    if (!latitude || !longitude) {
      return new StandardResponse(true, 'MISSING_COORDINATES', null);
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const rad = radius
      ? parseFloat(radius)
      : getRiderOrderOfferConfig().radiusKm;

    if (isNaN(lat) || isNaN(lng) || isNaN(rad)) {
      return new StandardResponse(true, 'INVALID_COORDINATES', null);
    }

    const riders = await this.riderService.findNearbyRiders(lat, lng, rad);

    return new StandardResponse(false, 'NEARBY_RIDERS_FETCHED', {
      count: riders.length,
      riders,
      searchArea: {
        latitude: lat,
        longitude: lng,
        radiusKm: rad,
      },
    });
  }

  @Get('rider/:riderId/live')
  @Permit([UserRoles.CUSTOMER, UserRoles.ADMIN])
  async getRiderLiveLocation(@Param('riderId') riderId: string) {
    const location =
      await this.locationTrackingService.getLastLocation(riderId);

    if (!location) {
      return new StandardResponse(true, 'LOCATION_NOT_FOUND', null);
    }

    // Get rider info
    const rider = await this.riderService.findById(riderId);

    return new StandardResponse(false, 'RIDER_LOCATION_FETCHED', {
      riderId,
      riderInfo: {
        name: `${rider.user?.firstName} ${rider.user?.lastName}`,
        bikeType: rider.bikeType,
        rating: rider.rating,
        isOnline: rider.isOnline,
      },
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        speed: location.speed,
        heading: location.heading,
        timestamp: location.timestamp,
      },
    });
  }

  @Get('rider/:riderId/history')
  @Permit([UserRoles.RIDER, UserRoles.ADMIN])
  async getRiderLocationHistory(
    @Param('riderId') riderId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const take = limit ? parseInt(limit) : 1000;

    const history = await this.locationTrackingService.getLocationHistory(
      riderId,
      start,
      end,
      take,
    );

    // Format for polyline
    const path = history.map((loc) => ({
      latitude: loc.latitude,
      longitude: loc.longitude,
      timestamp: loc.timestamp,
      speed: loc.speed,
    }));

    // Calculate stats
    const stats = {
      totalPoints: history.length,
      startTime: history[0]?.timestamp,
      endTime: history[history.length - 1]?.timestamp,
      averageSpeed: this.calculateAverageSpeed(history),
      maxSpeed: Math.max(...history.map((h) => h.speed || 0)),
      totalDistance: await this.calculateTotalDistance(history),
    };

    return new StandardResponse(false, 'LOCATION_HISTORY_FETCHED', {
      riderId,
      period: { start, end },
      stats,
      path,
    });
  }

  @Get('trip/:tripId/route')
  @Permit([UserRoles.RIDER, UserRoles.CUSTOMER, UserRoles.ADMIN])
  async getTripRoute(@Param('tripId') tripId: string) {
    const locations = await this.locationTrackingService.getTripRoute(tripId);

    if (locations.length === 0) {
      return new StandardResponse(true, 'TRIP_ROUTE_NOT_FOUND', null);
    }

    const path = locations.map((loc) => ({
      latitude: loc.latitude,
      longitude: loc.longitude,
      timestamp: loc.timestamp,
      speed: loc.speed,
    }));

    const distance =
      await this.locationTrackingService.calculateTripDistance(tripId);
    const duration =
      (locations[locations.length - 1].timestamp.getTime() -
        locations[0].timestamp.getTime()) /
      1000; // in seconds

    return new StandardResponse(false, 'TRIP_ROUTE_FETCHED', {
      tripId,
      stats: {
        distance: Math.round(distance),
        duration,
        averageSpeed: (distance / duration) * 3.6, // km/h
        startTime: locations[0].timestamp,
        endTime: locations[locations.length - 1].timestamp,
        pointsCount: locations.length,
      },
      path,
    });
  }

  @Get('heatmap')
  @Permit([UserRoles.ADMIN])
  async getHeatmap(
    @Query('north') north: string,
    @Query('south') south: string,
    @Query('east') east: string,
    @Query('west') west: string,
    @Query('timeRange') timeRange?: 'hour' | 'day' | 'week',
  ) {
    const bounds = {
      north: parseFloat(north),
      south: parseFloat(south),
      east: parseFloat(east),
      west: parseFloat(west),
    };

    const heatmap = await this.locationTrackingService.getHeatmapData(
      bounds,
      timeRange || 'hour',
    );

    return new StandardResponse(false, 'HEATMAP_DATA_FETCHED', {
      bounds,
      timeRange: timeRange || 'hour',
      points: heatmap,
      count: heatmap.length,
    });
  }

  @Post('cleanup/stale')
  @Permit([UserRoles.ADMIN])
  @HttpCode(HttpStatus.OK)
  async cleanupStaleLocations() {
    const count = await this.riderService.cleanupStaleOnlineStatus();

    return new StandardResponse(false, 'STALE_LOCATIONS_CLEANED', {
      cleanedCount: count,
      timestamp: new Date(),
    });
  }

  private calculateAverageSpeed(history: any[]): number {
    const speeds = history.filter((h) => h.speed).map((h) => h.speed);
    if (speeds.length === 0) return 0;
    return speeds.reduce((a, b) => a + b, 0) / speeds.length;
  }

  private async calculateTotalDistance(history: any[]): Promise<number> {
    if (history.length < 2) return 0;

    let total = 0;
    for (let i = 1; i < history.length; i++) {
      total += this.calculateDistance(
        history[i - 1].latitude,
        history[i - 1].longitude,
        history[i].latitude,
        history[i].longitude,
      );
    }
    return Math.round(total);
  }

  private calculateDistance(
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
}

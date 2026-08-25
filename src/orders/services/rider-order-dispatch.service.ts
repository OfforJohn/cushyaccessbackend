import { Injectable, Logger } from '@nestjs/common';
import { RiderGateway } from '../../riders/gateways/rider.gateway';
import { getRiderOrderOfferConfig } from '../../riders/rider-order-offer.config';
import { RiderService } from '../../riders/services/riders.service';
import { RedisCacheService } from '../../redis-cache/redis-cache.service';
import { Orders } from '../model/order.entity';
import { GoogleMapsService } from '../../utils/google-maps.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserLocations } from '../../users/model/user-locations.entity';
import { FCMTokenService } from '../../users/services/fcm-token.service';

@Injectable()
export class RiderOrderDispatchService {
  private readonly logger = new Logger(RiderOrderDispatchService.name);

  constructor(
    private readonly riderService: RiderService,
    private readonly riderGateway: RiderGateway,
    private readonly fcmTokenService: FCMTokenService,
    private readonly redisCacheService: RedisCacheService,
    private readonly googleMapsService: GoogleMapsService,
    @InjectRepository(UserLocations)
    private readonly userLocationsRepository: Repository<UserLocations>,
  ) {}

  async dispatch(order: Orders): Promise<number> {
    const pickup = await this.resolvePickupCoordinates(order);
    if (!pickup) {
      this.logger.warn(
        `Order ${order.id} has no valid pickup coordinates; no proximity offer was sent.`,
      );
      return 0;
    }
    const { latitude, longitude } = pickup;

    const { radiusKm, limit, maxLocationAgeMinutes, dedupTtlMs } =
      getRiderOrderOfferConfig();

    const riders = await this.riderService.findNearbyRiders(
      latitude,
      longitude,
      radiusKm,
      limit,
      maxLocationAgeMinutes,
    );
    if (!riders.length) {
      this.logger.log(`No eligible nearby riders found for order ${order.id}.`);
      return 0;
    }

    const offerKeys = riders.map(
      (rider) => `rider-order-offer:${order.id}:${rider.userId}`,
    );
    const declineKeys = riders.map(
      (rider) => `rider-order-decline:${rider.userId}:${order.id}`,
    );
    let existingOffers: unknown[] = [];
    let declinedOffers: unknown[] = [];
    try {
      [existingOffers, declinedOffers] = await Promise.all([
        Promise.all(
          offerKeys.map((key) => this.redisCacheService.getCachedItem(key)),
        ),
        Promise.all(
          declineKeys.map((key) => this.redisCacheService.getCachedItem(key)),
        ),
      ]);
    } catch (error) {
      // Dispatch remains available if Redis is briefly unavailable. This is
      // intentionally at-least-once rather than silently losing an order.
      this.logger.warn(
        `Could not read rider-offer deduplication state for order ${order.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      existingOffers = riders.map(() => undefined);
      declinedOffers = riders.map(() => undefined);
    }

    const payload = this.riderGateway.mapOrderResponsePublic(order);
    const riderNote = (order.noteForRider || '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const pushNote =
      riderNote.length > 140 ? `${riderNote.slice(0, 137)}...` : riderNote;
    const deliveredOfferKeys: string[] = [];
    const notifiedUserIds: string[] = [];
    let dispatchedCount = 0;
    riders.forEach((rider, index) => {
      if (existingOffers[index] || declinedOffers[index]) return;
      try {
        this.riderGateway.notifyNewOrder(rider.userId, payload);
        deliveredOfferKeys.push(offerKeys[index]);
        notifiedUserIds.push(rider.userId);
        dispatchedCount += 1;
      } catch (error) {
        this.logger.error(
          `Failed to offer order ${order.id} to rider ${rider.userId}.`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    });

    if (notifiedUserIds.length > 0) {
      await this.fcmTokenService.sendPushNotification({
        title: 'New Order Available',
        subtitle: 'Delivery Request',
        body:
          'A new delivery is available near your current location. ' +
          (pushNote ? `Customer note: ${pushNote}` : 'Tap to review.'),
        userIds: notifiedUserIds,
        sound: 'default',
        data: {
          route: 'NEW_ORDER_AVAILABLE',
          orderId: order.id,
          noteForRider: riderNote || undefined,
        },
      });
    }

    try {
      await Promise.all(
        deliveredOfferKeys.map((key) =>
          this.redisCacheService.setItemInCache(
            key,
            { sentAt: Date.now() },
            dedupTtlMs,
          ),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Could not persist rider-offer deduplication state for order ${order.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.logger.log(
      `Dispatched order ${order.id} to ${dispatchedCount} nearby eligible rider(s).`,
    );
    return dispatchedCount;
  }

  private async resolvePickupCoordinates(
    order: Orders,
  ): Promise<{ latitude: number; longitude: number } | null> {
    const rawLatitude = order.pickUpLocation?.latitude;
    const rawLongitude = order.pickUpLocation?.longitude;
    const latitude = Number(rawLatitude);
    const longitude = Number(rawLongitude);
    if (
      rawLatitude != null &&
      rawLatitude !== '' &&
      rawLongitude != null &&
      rawLongitude !== '' &&
      Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180
    ) {
      return { latitude, longitude };
    }

    const address =
      order.pickUpLocation?.address?.trim() ||
      order.pickUpLocationAddress?.trim();
    if (!address) return null;

    try {
      const resolved = await this.googleMapsService.geocodeAddress(address);
      const resolvedLatitude = Number(resolved.latitude);
      const resolvedLongitude = Number(resolved.longitude);
      if (
        !Number.isFinite(resolvedLatitude) ||
        resolvedLatitude < -90 ||
        resolvedLatitude > 90 ||
        !Number.isFinite(resolvedLongitude) ||
        resolvedLongitude < -180 ||
        resolvedLongitude > 180
      ) {
        return null;
      }

      if (order.pickUpLocationId) {
        await this.userLocationsRepository.update(
          { id: order.pickUpLocationId },
          {
            latitude: String(resolvedLatitude),
            longitude: String(resolvedLongitude),
            placeId: resolved.placeId,
          },
        );
      }
      if (order.pickUpLocation) {
        order.pickUpLocation.latitude = String(resolvedLatitude);
        order.pickUpLocation.longitude = String(resolvedLongitude);
        order.pickUpLocation.placeId = resolved.placeId;
      }
      this.logger.log(
        `Recovered pickup coordinates for order ${order.id} from its stored address.`,
      );
      return {
        latitude: resolvedLatitude,
        longitude: resolvedLongitude,
      };
    } catch (error) {
      this.logger.warn(
        `Could not recover pickup coordinates for order ${order.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}

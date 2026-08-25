import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Orders } from '../orders/model/order.entity';
import { UserLocations } from '../users/model/user-locations.entity';
import { Rider } from './model/rider.entity';
import { getRiderOrderOfferConfig } from './rider-order-offer.config';

type CoordinateSource = {
  latitude?: string | number | null;
  longitude?: string | number | null;
};

const coordinate = (
  value: unknown,
  min: number,
  max: number,
): number | null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
};

export const distanceBetweenCoordinatesKm = (
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
): number => {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

export const evaluateRiderPickupProximity = (
  rider: Pick<
    Rider,
    'currentLatitude' | 'currentLongitude' | 'lastLocationUpdate'
  >,
  pickup: CoordinateSource | null | undefined,
  options: {
    now?: number;
    radiusKm?: number;
    maxLocationAgeMinutes?: number;
  } = {},
): { eligible: boolean; distanceKm?: number; reason?: string } => {
  const config = getRiderOrderOfferConfig();
  const radiusKm = options.radiusKm ?? config.radiusKm;
  const maxLocationAgeMinutes =
    options.maxLocationAgeMinutes ?? config.maxLocationAgeMinutes;
  const riderLatitude = coordinate(rider.currentLatitude, -90, 90);
  const riderLongitude = coordinate(rider.currentLongitude, -180, 180);
  const pickupLatitude = coordinate(pickup?.latitude, -90, 90);
  const pickupLongitude = coordinate(pickup?.longitude, -180, 180);
  const now = options.now ?? Date.now();
  const locationAge = rider.lastLocationUpdate
    ? now - new Date(rider.lastLocationUpdate).getTime()
    : Number.POSITIVE_INFINITY;

  if (
    riderLatitude == null ||
    riderLongitude == null ||
    !Number.isFinite(locationAge) ||
    locationAge < 0 ||
    locationAge > maxLocationAgeMinutes * 60_000
  ) {
    return { eligible: false, reason: 'RIDER_LOCATION_NOT_FRESH' };
  }
  if (pickupLatitude == null || pickupLongitude == null) {
    return { eligible: false, reason: 'ORDER_PICKUP_LOCATION_UNAVAILABLE' };
  }

  const distanceKm = distanceBetweenCoordinatesKm(
    { latitude: riderLatitude, longitude: riderLongitude },
    { latitude: pickupLatitude, longitude: pickupLongitude },
  );
  return distanceKm <= radiusKm
    ? { eligible: true, distanceKm }
    : { eligible: false, distanceKm, reason: 'ORDER_OUTSIDE_RIDER_AREA' };
};

export async function assertRiderCanReceiveOrder(
  manager: EntityManager,
  rider: Rider,
  order: Orders,
): Promise<void> {
  const pickup =
    order.pickUpLocation ||
    (order.pickUpLocationId
      ? await manager.findOne(UserLocations, {
          where: { id: order.pickUpLocationId },
        })
      : null);
  const result = evaluateRiderPickupProximity(rider, pickup);
  if (result.eligible) return;

  if (result.reason === 'RIDER_LOCATION_NOT_FRESH') {
    throw new BadRequestException(
      'Refresh your current location before accepting this order',
    );
  }
  if (result.reason === 'ORDER_PICKUP_LOCATION_UNAVAILABLE') {
    throw new BadRequestException('Order pickup location is unavailable');
  }
  throw new BadRequestException(
    'This order is outside your current delivery area',
  );
}

import { evaluateRiderPickupProximity } from './rider-order-proximity';
import { getRiderOrderOfferConfig } from './rider-order-offer.config';

describe('rider order proximity', () => {
  const now = Date.parse('2026-08-05T08:00:00.000Z');
  const rider = {
    currentLatitude: 9.0153312,
    currentLongitude: 7.568101,
    lastLocationUpdate: new Date(now - 30_000),
  };

  it('defaults rider offers to an 18 km radius', () => {
    const previousRadius = process.env.RIDER_ORDER_OFFER_RADIUS_KM;
    delete process.env.RIDER_ORDER_OFFER_RADIUS_KM;
    try {
      expect(getRiderOrderOfferConfig().radiusKm).toBe(18);
    } finally {
      if (previousRadius === undefined) {
        delete process.env.RIDER_ORDER_OFFER_RADIUS_KM;
      } else {
        process.env.RIDER_ORDER_OFFER_RADIUS_KM = previousRadius;
      }
    }
  });

  it('uses the 18 km fallback for an empty environment value', () => {
    const previousRadius = process.env.RIDER_ORDER_OFFER_RADIUS_KM;
    process.env.RIDER_ORDER_OFFER_RADIUS_KM = '';
    try {
      expect(getRiderOrderOfferConfig().radiusKm).toBe(18);
    } finally {
      if (previousRadius === undefined) {
        delete process.env.RIDER_ORDER_OFFER_RADIUS_KM;
      } else {
        process.env.RIDER_ORDER_OFFER_RADIUS_KM = previousRadius;
      }
    }
  });

  it('includes pickups inside 18 km and rejects pickups outside it', () => {
    expect(
      evaluateRiderPickupProximity(
        rider as never,
        {
          latitude: rider.currentLatitude + 0.16,
          longitude: rider.currentLongitude,
        },
        { now, radiusKm: 18, maxLocationAgeMinutes: 5 },
      ),
    ).toMatchObject({ eligible: true });
    expect(
      evaluateRiderPickupProximity(
        rider as never,
        {
          latitude: rider.currentLatitude + 0.163,
          longitude: rider.currentLongitude,
        },
        { now, radiusKm: 18, maxLocationAgeMinutes: 5 },
      ),
    ).toMatchObject({
      eligible: false,
      reason: 'ORDER_OUTSIDE_RIDER_AREA',
    });
  });

  it('allows a pickup close to the rider', () => {
    expect(
      evaluateRiderPickupProximity(
        rider as never,
        { latitude: '9.02', longitude: '7.57' },
        { now, radiusKm: 8, maxLocationAgeMinutes: 5 },
      ),
    ).toMatchObject({ eligible: true });
  });

  it('rejects a pickup in another city', () => {
    expect(
      evaluateRiderPickupProximity(
        rider as never,
        { latitude: '9.6139', longitude: '6.5569' },
        { now, radiusKm: 8, maxLocationAgeMinutes: 5 },
      ),
    ).toMatchObject({
      eligible: false,
      reason: 'ORDER_OUTSIDE_RIDER_AREA',
    });
  });

  it('rejects stale rider coordinates', () => {
    expect(
      evaluateRiderPickupProximity(
        {
          ...rider,
          lastLocationUpdate: new Date(now - 6 * 60_000),
        } as never,
        { latitude: '9.02', longitude: '7.57' },
        { now, radiusKm: 8, maxLocationAgeMinutes: 5 },
      ),
    ).toMatchObject({
      eligible: false,
      reason: 'RIDER_LOCATION_NOT_FRESH',
    });
  });
});

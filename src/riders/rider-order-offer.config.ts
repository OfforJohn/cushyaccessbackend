const boundedNumberSetting = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, parsed))
    : fallback;
};

export const getRiderOrderOfferConfig = () => ({
  radiusKm: boundedNumberSetting(
    process.env.RIDER_ORDER_OFFER_RADIUS_KM,
    18,
    1,
    25,
  ),
  limit: boundedNumberSetting(process.env.RIDER_ORDER_OFFER_LIMIT, 30, 1, 100),
  maxLocationAgeMinutes: boundedNumberSetting(
    process.env.RIDER_LOCATION_FRESHNESS_MINUTES,
    5,
    1,
    30,
  ),
  dedupTtlMs: boundedNumberSetting(
    process.env.RIDER_ORDER_OFFER_DEDUP_TTL_MS,
    90_000,
    30_000,
    300_000,
  ),
});

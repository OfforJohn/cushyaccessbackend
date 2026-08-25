export const RIDER_PLATFORM_COMMISSION_RATE = 0.2;
export const RIDER_NET_PAYOUT_RATE = 1 - RIDER_PLATFORM_COMMISSION_RATE;

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function calculateRiderCommission(deliveryFee: number) {
  const numericDeliveryFee = Number(deliveryFee);
  const grossDeliveryFee = roundMoney(
    Number.isFinite(numericDeliveryFee) ? Math.max(0, numericDeliveryFee) : 0,
  );
  const platformCommission = roundMoney(
    grossDeliveryFee * RIDER_PLATFORM_COMMISSION_RATE,
  );

  return {
    grossDeliveryFee,
    platformCommissionRate: RIDER_PLATFORM_COMMISSION_RATE,
    platformCommission,
    netRiderPayout: roundMoney(grossDeliveryFee - platformCommission),
  };
}

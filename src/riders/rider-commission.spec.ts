import {
  calculateRiderCommission,
  RIDER_NET_PAYOUT_RATE,
  RIDER_PLATFORM_COMMISSION_RATE,
} from './rider-commission';

describe('calculateRiderCommission', () => {
  it('applies the single 20/80 commission policy', () => {
    expect(RIDER_PLATFORM_COMMISSION_RATE).toBe(0.2);
    expect(RIDER_NET_PAYOUT_RATE).toBe(0.8);
    expect(calculateRiderCommission(4050)).toEqual({
      grossDeliveryFee: 4050,
      platformCommissionRate: 0.2,
      platformCommission: 810,
      netRiderPayout: 3240,
    });
  });

  it('rounds currency components to two decimal places', () => {
    expect(calculateRiderCommission(10.01)).toEqual({
      grossDeliveryFee: 10.01,
      platformCommissionRate: 0.2,
      platformCommission: 2,
      netRiderPayout: 8.01,
    });
  });

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])(
    'never produces a negative or invalid payout for %p',
    (value) => {
      expect(calculateRiderCommission(value)).toEqual({
        grossDeliveryFee: 0,
        platformCommissionRate: 0.2,
        platformCommission: 0,
        netRiderPayout: 0,
      });
    },
  );
});

import {
  getMerchantNetSettlement,
  getMerchantSettlementBase,
} from './merchant-settlement';

describe('merchant settlement policy', () => {
  it('keeps Cushy-funded coupons out of the merchant settlement base', () => {
    const merchantDiscountedSubtotalBeforeCoupon = 2_700;
    const customerCouponDiscount = 500;

    expect(
      getMerchantSettlementBase(merchantDiscountedSubtotalBeforeCoupon),
    ).toBe(2_700);
    expect(
      getMerchantSettlementBase(merchantDiscountedSubtotalBeforeCoupon),
    ).not.toBe(merchantDiscountedSubtotalBeforeCoupon - customerCouponDiscount);
    expect(
      getMerchantNetSettlement(merchantDiscountedSubtotalBeforeCoupon),
    ).toBe(2_565);
  });

  it('never creates a negative settlement base', () => {
    expect(getMerchantSettlementBase(-100)).toBe(0);
  });

  it('rounds financial results to currency precision', () => {
    expect(getMerchantSettlementBase(100.009)).toBe(100.01);
    expect(getMerchantNetSettlement(100.01)).toBe(95.01);
  });
});

export const MERCHANT_PLATFORM_FEE_RATE = 0.05;

const roundCurrency = (amount: number) =>
  Math.round((amount + Number.EPSILON) * 100) / 100;

/**
 * Merchant discounts are already reflected in this subtotal. Cushy-funded
 * coupons are applied after it, so they must not reduce the merchant's reward.
 */
export const getMerchantSettlementBase = (
  subtotalAfterMerchantDiscounts: number,
) => roundCurrency(Math.max(0, Number(subtotalAfterMerchantDiscounts) || 0));

export const getMerchantNetSettlement = (settlementBase: number) =>
  roundCurrency(
    getMerchantSettlementBase(settlementBase) *
      (1 - MERCHANT_PLATFORM_FEE_RATE),
  );

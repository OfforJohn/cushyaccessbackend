import { OrdersMapper } from './orders-mapper.service';

describe('OrdersMapper cart coupon totals', () => {
  it('exposes the original subtotal, discount, applied code and discounted total', () => {
    const response = new OrdersMapper().mapCartResponse(
      {
        id: 'cart-1',
        cartItems: [],
        totalAmount: 2612.5,
        subtotalBeforeDiscount: 2750,
        discountAmount: 137.5,
        appliedCouponCode: 'BDAY-2026-TEST',
        pickUpLocationId: 'pickup-1',
        dropOffLocationId: 'dropoff-1',
      } as any,
      null as any,
    );

    expect(response).toEqual(
      expect.objectContaining({
        totalAmount: 2612.5,
        subtotalBeforeDiscount: 2750,
        discountAmount: 137.5,
        appliedCouponCode: 'BDAY-2026-TEST',
      }),
    );
  });
});

/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
import { CouponStatus, CouponType } from 'src/promo-code/model/coupon.entity';
import { Cart } from '../model/cart.entity';
import { CartService } from './cart.service';

jest.mock('src/user-otp/mail-sender.service', () => ({
  MailSenderService: class MailSenderService {},
}));

describe('CartService coupon recalculation', () => {
  const createHarness = () => {
    const cartRepository = {
      save: jest.fn(async (value) => value),
    };
    const menuItemRepository = {
      findBy: jest.fn().mockResolvedValue([{ id: 'menu-1', price: 100 }]),
    };
    const menuItemService = {
      getFinalMenuPrice: jest.fn((menuItem) => menuItem.price),
    };
    const promoCodeService = {
      validateCoupon: jest.fn().mockResolvedValue({
        type: CouponType.PERCENT,
        value: 5,
        status: CouponStatus.ACTIVE,
      }),
    };
    const service = new CartService(
      cartRepository as any,
      {} as any,
      {} as any,
      {} as any,
      menuItemRepository as any,
      {} as any,
      {} as any,
      {} as any,
      menuItemService as any,
      promoCodeService as any,
      {} as any,
    );
    return {
      service,
      cartRepository,
      promoCodeService,
    };
  };

  const createCart = () =>
    ({
      id: 'cart-1',
      userId: 'user-1',
      storeId: 'store-1',
      appliedCouponCode: 'BDAY-2026-TEST',
      discountAmount: 0,
      subtotalBeforeDiscount: 0,
      totalAmount: 0,
      cartItems: [
        {
          id: 'item-1',
          menuItemId: 'menu-1',
          price: 100,
          quantity: 2,
        },
      ],
    }) as Cart;

  it('recomputes a percentage discount when cart quantity changes', async () => {
    const harness = createHarness();
    const cart = createCart();

    await harness.service.calculateCartAmounts(cart);
    expect(cart.subtotalBeforeDiscount).toBe(200);
    expect(cart.discountAmount).toBe(10);
    expect(cart.totalAmount).toBe(190);

    cart.cartItems[0].quantity = 3;
    await harness.service.calculateCartAmounts(cart);
    expect(cart.subtotalBeforeDiscount).toBe(300);
    expect(cart.discountAmount).toBe(15);
    expect(cart.totalAmount).toBe(285);
  });

  it('removes an expired coupon instead of retaining a stale discount', async () => {
    const harness = createHarness();
    const cart = createCart();
    harness.promoCodeService.validateCoupon.mockRejectedValue(
      new BadRequestException('COUPON_EXPIRED'),
    );

    await harness.service.calculateCartAmounts(cart);

    expect(cart.appliedCouponCode).toBeNull();
    expect(cart.discountAmount).toBe(0);
    expect(cart.totalAmount).toBe(200);
    expect(harness.cartRepository.save).toHaveBeenCalledTimes(1);
  });
});

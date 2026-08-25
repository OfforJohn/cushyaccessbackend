/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
import { Orders } from 'src/orders/model/order.entity';
import {
  Coupon,
  CouponSource,
  CouponStatus,
  CouponType,
} from '../model/coupon.entity';
import { CouponRedemption } from '../model/coupon-redemption.entity';
import { PromoCodeService } from './promo-code.service';

describe('PromoCodeService coupon safety', () => {
  const createHarness = () => {
    const couponRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      find: jest.fn(),
      manager: {
        transaction: jest.fn(),
      },
    };
    const service = new PromoCodeService(
      couponRepository as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, couponRepository };
  };

  it('normalizes admin coupons and treats a date-only end date as end-of-day in Lagos', async () => {
    const harness = createHarness();

    const coupon = await harness.service.createCoupon(
      {
        code: '  summer5 ',
        type: CouponType.PERCENT,
        value: 5,
        startDate: '2026-07-01',
        endDate: '2026-07-02',
      },
      'admin-1',
    );

    expect(coupon).toEqual(
      expect.objectContaining({
        code: 'SUMMER5',
        appliesTo: 'SITE',
        startDate: new Date('2026-06-30T23:00:00.000Z'),
        endDate: new Date('2026-07-02T22:59:59.999Z'),
        createdBy: { id: 'admin-1' },
      }),
    );
  });

  it('rejects percentage coupons above 100 percent', async () => {
    const harness = createHarness();

    await expect(
      harness.service.createCoupon({
        code: 'TOO-MUCH',
        type: CouponType.PERCENT,
        value: 101,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.couponRepository.save).not.toHaveBeenCalled();
  });

  it('saves the order and consumes its one-time coupon in one transaction', async () => {
    const harness = createHarness();
    const coupon = {
      id: 'coupon-1',
      code: 'BDAY-2026-TEST',
      status: CouponStatus.ACTIVE,
      source: CouponSource.BIRTHDAY,
      type: CouponType.PERCENT,
      value: 5,
      appliesTo: 'SITE',
      usageLimit: 1,
      timesUsed: 0,
      audienceUserId: 'user-1',
      startDate: null,
      endDate: new Date(Date.now() + 60_000),
    } as Coupon;
    const couponQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(coupon),
    };
    const transactionalCouponRepository = {
      createQueryBuilder: jest.fn(() => couponQueryBuilder),
      save: jest.fn(async (value) => value),
    };
    const redemptionRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const orderRepository = {
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Orders) return orderRepository;
        if (entity === Coupon) return transactionalCouponRepository;
        if (entity === CouponRedemption) return redemptionRepository;
        throw new Error('Unexpected repository');
      }),
    };
    harness.couponRepository.manager.transaction.mockImplementation(
      async (work) => work(manager),
    );
    const order = { id: 'order-1' } as Orders;

    const savedOrder = await harness.service.saveOrderWithCouponUse(
      order,
      coupon.code,
      'user-1',
      'store-1',
    );

    expect(savedOrder).toBe(order);
    expect(orderRepository.save).toHaveBeenCalledWith(order);
    expect(couponQueryBuilder.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
    );
    expect(redemptionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        couponId: coupon.id,
        userId: 'user-1',
        orderId: order.id,
      }),
    );
    expect(coupon.timesUsed).toBe(1);
    expect(coupon.status).toBe(CouponStatus.INACTIVE);
  });
});

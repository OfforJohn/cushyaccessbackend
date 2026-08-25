/// <reference types="jest" />

import { EventBus } from '@nestjs/cqrs';
import { Users } from 'src/users/model/users.entity';
import { CouponSource, CouponStatus } from '../model/coupon.entity';
import { BirthdayRewardService } from './birthday-reward.service';
import { BirthdayUpdatedEvent } from 'src/users/events/birthday-updated.event';

jest.mock('src/user-otp/mail-sender.service', () => ({
  MailSenderService: class MailSenderService {},
}));

describe('BirthdayRewardService', () => {
  const user = {
    id: 'user-1',
    firstName: 'Ada',
    email: 'ada@example.com',
  } as Users;

  const createHarness = (existingCoupon: object | null = null) => {
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([user]),
    };
    const usersRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      findOne: jest.fn(),
    };
    const couponQueryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const retryQueryBuilder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const couponRepository = {
      findOne: jest.fn().mockResolvedValue(existingCoupon),
      createQueryBuilder: jest.fn((alias?: string) =>
        alias === 'coupon' ? retryQueryBuilder : couponQueryBuilder,
      ),
      create: jest.fn((value) => ({
        id: 'coupon-1',
        birthdayEmailClaimedAt: null,
        birthdayEmailSentAt: null,
        ...value,
      })),
      save: jest.fn(async (value) => value),
    };
    const mailSenderService = {
      sendMail: jest.fn().mockResolvedValue({}),
    };
    const eventBus = {
      publish: jest.fn(),
    };
    const service = new BirthdayRewardService(
      usersRepository as any,
      couponRepository as any,
      mailSenderService as any,
      eventBus as unknown as EventBus,
    );

    return {
      service,
      usersRepository,
      queryBuilder,
      couponRepository,
      couponQueryBuilder,
      retryQueryBuilder,
      mailSenderService,
      eventBus,
    };
  };

  it('issues a single-use 5% reward that expires after 48 hours', async () => {
    const harness = createHarness();
    const now = new Date('2026-07-29T07:00:00.000Z');

    await harness.service.issueRewardsForDate(now);

    expect(harness.queryBuilder.andWhere).toHaveBeenCalledWith(
      "TO_CHAR(user.dateOfBirth, 'MM-DD') IN (:...birthdayDates)",
      { birthdayDates: ['07-29'] },
    );
    expect(harness.couponRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 5,
        appliesTo: 'SITE',
        usageLimit: 1,
        source: CouponSource.BIRTHDAY,
        status: CouponStatus.ACTIVE,
        audienceUserId: user.id,
        campaignKey: 'BIRTHDAY:user-1:2026',
        startDate: now,
        endDate: new Date('2026-07-31T07:00:00.000Z'),
      }),
    );
    expect(harness.eventBus.publish).toHaveBeenCalledTimes(1);
    expect(harness.mailSenderService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: user.email,
        template: 'birthday-reward',
        subject: 'Ada, your birthday treat is here!',
        content: expect.objectContaining({
          firstName: 'Ada',
          discountPercentage: 5,
          assetBaseUrl: 'https://api.cushyaccess.com',
        }),
      }),
    );
    expect(harness.couponQueryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({ birthdayEmailSentAt: expect.any(Date) }),
    );
  });

  it('does not issue or notify twice for the same yearly campaign', async () => {
    const harness = createHarness({
      id: 'existing-coupon',
      birthdayEmailSentAt: new Date('2026-07-29T07:01:00.000Z'),
    });

    await harness.service.issueRewardsForDate(
      new Date('2026-07-29T07:00:00.000Z'),
    );

    expect(harness.couponRepository.save).not.toHaveBeenCalled();
    expect(harness.eventBus.publish).not.toHaveBeenCalled();
    expect(harness.mailSenderService.sendMail).not.toHaveBeenCalled();
  });

  it('sends a pending email for an existing coupon without repeating the push', async () => {
    const harness = createHarness({
      id: 'existing-coupon',
      code: 'BDAY-2026-EXISTING',
      value: 5,
      endDate: new Date('2026-07-31T07:00:00.000Z'),
      birthdayEmailSentAt: null,
    });

    await harness.service.issueRewardsForDate(
      new Date('2026-07-29T09:00:00.000Z'),
    );

    expect(harness.couponRepository.save).not.toHaveBeenCalled();
    expect(harness.eventBus.publish).not.toHaveBeenCalled();
    expect(harness.mailSenderService.sendMail).toHaveBeenCalledTimes(1);
  });

  it('releases a failed email claim so a later run can retry', async () => {
    const harness = createHarness({
      id: 'existing-coupon',
      code: 'BDAY-2026-RETRY',
      value: 5,
      endDate: new Date('2026-07-31T07:00:00.000Z'),
      birthdayEmailSentAt: null,
    });
    harness.mailSenderService.sendMail
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ messageId: 'accepted' });

    await harness.service.issueRewardsForDate(
      new Date('2026-07-29T07:00:00.000Z'),
    );
    await harness.service.issueRewardsForDate(
      new Date('2026-07-29T09:00:00.000Z'),
    );

    expect(harness.mailSenderService.sendMail).toHaveBeenCalledTimes(2);
    expect(harness.couponQueryBuilder.set).toHaveBeenCalledWith({
      birthdayEmailClaimedAt: null,
    });
    expect(harness.couponQueryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({ birthdayEmailSentAt: expect.any(Date) }),
    );
  });

  it('does not send when another worker already owns the email claim', async () => {
    const harness = createHarness({
      id: 'existing-coupon',
      code: 'BDAY-2026-CLAIMED',
      value: 5,
      endDate: new Date('2026-07-31T07:00:00.000Z'),
      birthdayEmailSentAt: null,
    });
    harness.couponQueryBuilder.execute.mockResolvedValueOnce({ affected: 0 });

    await harness.service.issueRewardsForDate(
      new Date('2026-07-29T07:00:00.000Z'),
    );

    expect(harness.mailSenderService.sendMail).not.toHaveBeenCalled();
  });

  it('retries a still-valid pending birthday email on the next day', async () => {
    const harness = createHarness();
    harness.retryQueryBuilder.getMany.mockResolvedValue([
      {
        id: 'pending-coupon',
        code: 'BDAY-2026-NEXTDAY',
        value: 5,
        startDate: new Date('2026-07-29T07:00:00.000Z'),
        endDate: new Date('2026-07-31T07:00:00.000Z'),
        timesUsed: 0,
        usageLimit: 1,
        birthdayEmailSentAt: null,
        audienceUser: user,
      },
    ]);

    await harness.service.retryPendingEmails(
      new Date('2026-07-30T07:00:00.000Z'),
    );

    expect(harness.mailSenderService.sendMail).toHaveBeenCalledTimes(1);
    expect(harness.retryQueryBuilder.andWhere).toHaveBeenCalledWith(
      'coupon."endDate" > :now',
      { now: new Date('2026-07-30T07:00:00.000Z') },
    );
    expect(harness.retryQueryBuilder.andWhere).toHaveBeenCalledWith(
      '(coupon."usageLimit" IS NULL OR coupon."timesUsed" < coupon."usageLimit")',
    );
    expect(harness.retryQueryBuilder.orderBy).toHaveBeenCalledWith(
      'coupon.endDate',
      'ASC',
    );
  });

  it('does not run scheduled birthday work on an API process', async () => {
    const harness = createHarness();
    const previousRole = process.env.APP_ROLE;
    process.env.APP_ROLE = 'api';

    try {
      await harness.service.issueDailyBirthdayRewards();
      await harness.service.retryPendingBirthdayRewardEmails();
    } finally {
      if (previousRole === undefined) delete process.env.APP_ROLE;
      else process.env.APP_ROLE = previousRole;
    }

    expect(harness.usersRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(harness.retryQueryBuilder.getMany).not.toHaveBeenCalled();
  });

  it('keeps the email retryable if acceptance cannot be recorded', async () => {
    const harness = createHarness({
      id: 'existing-coupon',
      code: 'BDAY-2026-STATE',
      value: 5,
      endDate: new Date('2026-07-31T07:00:00.000Z'),
      birthdayEmailSentAt: null,
    });
    harness.couponQueryBuilder.execute
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 })
      .mockResolvedValueOnce({ affected: 1 });

    await harness.service.issueRewardsForDate(
      new Date('2026-07-29T07:00:00.000Z'),
    );

    expect(harness.mailSenderService.sendMail).toHaveBeenCalledTimes(1);
    expect(harness.couponQueryBuilder.set).toHaveBeenCalledWith({
      birthdayEmailClaimedAt: null,
    });
  });

  it('retries a coupon-code collision without sending duplicate notifications', async () => {
    const harness = createHarness();
    harness.couponRepository.save
      .mockRejectedValueOnce({ code: '23505' })
      .mockImplementationOnce(async (value) => value);

    await harness.service.issueRewardsForDate(
      new Date('2026-07-29T07:00:00.000Z'),
    );

    expect(harness.couponRepository.save).toHaveBeenCalledTimes(2);
    expect(harness.eventBus.publish).toHaveBeenCalledTimes(1);
    expect(harness.mailSenderService.sendMail).toHaveBeenCalledTimes(1);
  });

  it('immediately issues a reward when a birthday is added on the birthday', async () => {
    const harness = createHarness();
    const lagosParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const getPart = (type: Intl.DateTimeFormatPartTypes) =>
      lagosParts.find((part) => part.type === type)?.value;
    harness.usersRepository.findOne.mockResolvedValue({
      ...user,
      dateOfBirth: `1990-${getPart('month')}-${getPart('day')}`,
    });

    await harness.service.handle(new BirthdayUpdatedEvent(user.id));

    expect(harness.couponRepository.save).toHaveBeenCalledTimes(1);
    expect(harness.eventBus.publish).toHaveBeenCalledTimes(1);
    expect(harness.mailSenderService.sendMail).toHaveBeenCalledTimes(1);
  });
});

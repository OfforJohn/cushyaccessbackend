import { Injectable, Logger } from '@nestjs/common';
import { EventBus, EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { MailSenderService } from 'src/user-otp/mail-sender.service';
import { PushNotificationEvent } from 'src/users/events/push-notification.event';
import { NotificationCategory } from 'src/users/model/notification-category';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { Users } from 'src/users/model/users.entity';
import { Repository } from 'typeorm';
import {
  Coupon,
  CouponSource,
  CouponStatus,
  CouponType,
} from '../model/coupon.entity';
import { BirthdayUpdatedEvent } from 'src/users/events/birthday-updated.event';

const BIRTHDAY_EMAIL_CLAIM_TTL_MS = 15 * 60 * 1000;
const BIRTHDAY_EMAIL_RETRY_LIMIT = 500;
const BIRTHDAY_EMAIL_BATCH_SIZE = 25;

@Injectable()
@EventsHandler(BirthdayUpdatedEvent)
export class BirthdayRewardService implements IEventHandler<BirthdayUpdatedEvent> {
  private readonly logger = new Logger(BirthdayRewardService.name);

  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(Coupon)
    private readonly couponRepository: Repository<Coupon>,
    private readonly mailSenderService: MailSenderService,
    private readonly eventBus: EventBus,
  ) {}

  // Issuance scans birthdays once. Email retries use the much smaller pending
  // coupon set below instead of repeatedly scanning the users table.
  @Cron('0 8 * * *', { timeZone: 'Africa/Lagos' })
  async issueDailyBirthdayRewards() {
    if (process.env.APP_ROLE !== 'worker') return;
    await this.issueRewardsForDate(new Date());
  }

  // Six lightweight passes cover transient provider failures throughout the
  // coupon's 48-hour lifetime, including a final pre-expiry morning attempt.
  @Cron('0 7,10,13,16,19,22 * * *', { timeZone: 'Africa/Lagos' })
  async retryPendingBirthdayRewardEmails() {
    if (process.env.APP_ROLE !== 'worker') return;
    await this.retryPendingEmails(new Date());
  }

  async retryPendingEmails(now: Date) {
    const staleBefore = new Date(now.getTime() - BIRTHDAY_EMAIL_CLAIM_TTL_MS);
    const pendingCoupons = await this.couponRepository
      .createQueryBuilder('coupon')
      .innerJoinAndSelect('coupon.audienceUser', 'audienceUser')
      .where('coupon.source = :source', { source: CouponSource.BIRTHDAY })
      .andWhere('coupon.status = :status', { status: CouponStatus.ACTIVE })
      .andWhere('coupon."birthdayEmailSentAt" IS NULL')
      .andWhere('coupon."startDate" <= :now', { now })
      .andWhere('coupon."endDate" > :now', { now })
      .andWhere(
        '(coupon."usageLimit" IS NULL OR coupon."timesUsed" < coupon."usageLimit")',
      )
      .andWhere(
        '(coupon."birthdayEmailClaimedAt" IS NULL OR coupon."birthdayEmailClaimedAt" < :staleBefore)',
        { staleBefore },
      )
      // ORDER BY expects an entity property path. Embedding SQL quotes makes
      // TypeORM look up a non-existent `"endDate"` property and crash while
      // resolving its database column metadata.
      .orderBy('coupon.endDate', 'ASC')
      .addOrderBy('coupon.id', 'ASC')
      .take(BIRTHDAY_EMAIL_RETRY_LIMIT)
      .getMany();

    let sent = 0;
    const failed: PromiseRejectedResult[] = [];
    for (
      let index = 0;
      index < pendingCoupons.length;
      index += BIRTHDAY_EMAIL_BATCH_SIZE
    ) {
      const results = await Promise.allSettled(
        pendingCoupons
          .slice(index, index + BIRTHDAY_EMAIL_BATCH_SIZE)
          .map((coupon) =>
            coupon.audienceUser
              ? this.sendBirthdayRewardEmail(coupon, coupon.audienceUser)
              : Promise.resolve(false),
          ),
      );
      sent += results.filter(
        (result) => result.status === 'fulfilled' && result.value,
      ).length;
      failed.push(
        ...results.filter(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        ),
      );
    }

    failed.forEach((result) => {
      this.logger.error('Birthday reward email retry failed', result.reason);
    });
    if (pendingCoupons.length === BIRTHDAY_EMAIL_RETRY_LIMIT) {
      this.logger.warn(
        `Birthday email retry reached the ${BIRTHDAY_EMAIL_RETRY_LIMIT}-coupon safety limit; remaining coupons will be processed on the next pass`,
      );
    }
    this.logger.log(
      `Birthday email retry complete: ${sent} sent, ${failed.length} failed`,
    );
  }

  async handle(event: BirthdayUpdatedEvent) {
    const user = await this.usersRepository.findOne({
      where: { id: event.userId, userRole: UserRoles.CUSTOMER },
      select: ['id', 'firstName', 'email', 'dateOfBirth'],
    });
    if (!user?.dateOfBirth) return;

    const now = new Date();
    const { year, month, day } = this.getLagosDateParts(now);
    if (
      !this.getBirthdayDates(year, month, day).includes(
        user.dateOfBirth.slice(5),
      )
    ) {
      return;
    }
    await this.issueReward(user, year, now);
  }

  async issueRewardsForDate(now: Date) {
    const { year, month, day } = this.getLagosDateParts(now);
    const birthdayDates = this.getBirthdayDates(year, month, day);

    const users = await this.usersRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.firstName', 'user.email'])
      .where('user.userRole = :role', { role: UserRoles.CUSTOMER })
      .andWhere('user.dateOfBirth IS NOT NULL')
      .andWhere("TO_CHAR(user.dateOfBirth, 'MM-DD') IN (:...birthdayDates)", {
        birthdayDates,
      })
      .getMany();

    let issued = 0;
    const failed: PromiseRejectedResult[] = [];
    const batchSize = BIRTHDAY_EMAIL_BATCH_SIZE;

    for (let index = 0; index < users.length; index += batchSize) {
      const results = await Promise.allSettled(
        users
          .slice(index, index + batchSize)
          .map((user) => this.issueReward(user, year, now)),
      );
      issued += results.filter(
        (result) => result.status === 'fulfilled' && result.value,
      ).length;
      failed.push(
        ...results.filter(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        ),
      );
    }

    failed.forEach((result) => {
      this.logger.error('Birthday reward issuance failed', result.reason);
    });
    this.logger.log(
      `Birthday reward run complete: ${issued} issued, ${failed.length} failed`,
    );
  }

  private async issueReward(user: Users, year: number, now: Date) {
    const campaignKey = `BIRTHDAY:${user.id}:${year}`;
    const existing = await this.couponRepository.findOne({
      where: { campaignKey },
    });
    if (existing) {
      await this.sendBirthdayRewardEmail(existing, user);
      return false;
    }

    const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    let coupon: Coupon | null = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = `BDAY-${year}-${randomBytes(4).toString('hex').toUpperCase()}`;
      const candidate = this.couponRepository.create({
        code,
        type: CouponType.PERCENT,
        value: 5,
        appliesTo: 'SITE',
        usageLimit: 1,
        timesUsed: 0,
        startDate: now,
        endDate: expiresAt,
        status: CouponStatus.ACTIVE,
        source: CouponSource.BIRTHDAY,
        audienceUserId: user.id,
        campaignKey,
        createdBy: null,
      });

      try {
        coupon = await this.couponRepository.save(candidate);
        break;
      } catch (error: any) {
        if (error?.code !== '23505') throw error;
        const campaignExists = await this.couponRepository.findOne({
          where: { campaignKey },
        });
        if (campaignExists) {
          await this.sendBirthdayRewardEmail(campaignExists, user);
          return false;
        }
        if (attempt === 4) throw error;
      }
    }

    if (!coupon) {
      throw new Error(`Could not create birthday reward for user ${user.id}`);
    }

    const notificationInfo = JSON.stringify({
      code: coupon.code,
      expiresAt: expiresAt.toISOString(),
      discountPercentage: 5,
    });
    this.eventBus.publish(
      new PushNotificationEvent(
        user.id,
        NotificationCategory.BIRTHDAY_REWARD,
        notificationInfo,
      ),
    );
    await this.sendBirthdayRewardEmail(coupon, user);
    return true;
  }

  private async sendBirthdayRewardEmail(coupon: Coupon, user: Users) {
    if (coupon.birthdayEmailSentAt) return false;

    if (!coupon.endDate) {
      throw new Error(`Birthday reward ${coupon.id} has no expiry date`);
    }

    if (!user.email) {
      this.logger.warn(
        `Cannot send birthday reward ${coupon.id}: user ${user.id} has no email`,
      );
      return false;
    }

    const claimedAt = new Date();
    const staleBefore = new Date(
      claimedAt.getTime() - BIRTHDAY_EMAIL_CLAIM_TTL_MS,
    );
    const claim = await this.couponRepository
      .createQueryBuilder()
      .update(Coupon)
      .set({ birthdayEmailClaimedAt: claimedAt })
      .where('id = :id', { id: coupon.id })
      .andWhere('"birthdayEmailSentAt" IS NULL')
      .andWhere(
        '("birthdayEmailClaimedAt" IS NULL OR "birthdayEmailClaimedAt" < :staleBefore)',
        { staleBefore },
      )
      .execute();

    if (claim.affected !== 1) return false;

    try {
      const delivery = await this.mailSenderService.sendMail({
        recipient: user.email,
        subject: `${user.firstName || 'A special someone'}, your birthday treat is here!`,
        template: 'birthday-reward',
        content: {
          firstName: user.firstName || 'there',
          code: coupon.code,
          expiresAtFormatted: new Intl.DateTimeFormat('en-NG', {
            timeZone: 'Africa/Lagos',
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(coupon.endDate),
          discountPercentage: Number(coupon.value),
          assetBaseUrl: (
            process.env.PUBLIC_API_URL || 'https://api.cushyaccess.com'
          ).replace(/\/$/, ''),
        },
      });

      if (!delivery) {
        throw new Error('Brevo did not accept the birthday reward email');
      }

      const recorded = await this.couponRepository
        .createQueryBuilder()
        .update(Coupon)
        .set({
          birthdayEmailSentAt: new Date(),
          birthdayEmailClaimedAt: null,
        })
        .where('id = :id', { id: coupon.id })
        .andWhere('"birthdayEmailSentAt" IS NULL')
        .execute();

      if (recorded.affected !== 1) {
        const currentState = await this.couponRepository.findOne({
          where: { id: coupon.id },
          select: ['id', 'birthdayEmailSentAt'],
        });
        if (!currentState?.birthdayEmailSentAt) {
          throw new Error(
            `Birthday reward email ${coupon.id} was accepted but its delivery state was not recorded`,
          );
        }
      }
      return true;
    } catch (error) {
      await this.couponRepository
        .createQueryBuilder()
        .update(Coupon)
        .set({ birthdayEmailClaimedAt: null })
        .where('id = :id', { id: coupon.id })
        .andWhere('"birthdayEmailClaimedAt" = :claimedAt', { claimedAt })
        .execute();
      throw error;
    }
  }

  private getLagosDateParts(date: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    return { year: get('year'), month: get('month'), day: get('day') };
  }

  private isLeapYear(year: number) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }

  private getBirthdayDates(year: number, month: number, day: number) {
    const birthdayDates = [
      `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    ];
    if (month === 2 && day === 28 && !this.isLeapYear(year)) {
      birthdayDates.push('02-29');
    }
    return birthdayDates;
  }
}

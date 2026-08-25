import { Module } from '@nestjs/common';
import { PromoCodeService } from './service/promo-code.service';
import { PromoCodes } from './model/promo-code.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromoCodeController } from './controllers/promo-code.controller';
import { UsersModule } from '../users/users.module';
import { Coupon } from './model/coupon.entity';
import { Users } from 'src/users/model/users.entity';
import { CouponRedemption } from './model/coupon-redemption.entity';
import { BirthdayRewardService } from './service/birthday-reward.service';
import { CqrsModule } from '@nestjs/cqrs';
import { UserOtpModule } from 'src/user-otp/user-otp.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PromoCodes, Coupon, Users, CouponRedemption]),
    CqrsModule,
    UsersModule,
    UserOtpModule,
  ],

  providers: [PromoCodeService, BirthdayRewardService],
  exports: [PromoCodeService],
  controllers: [PromoCodeController],
})
export class PromoCodeModule {}

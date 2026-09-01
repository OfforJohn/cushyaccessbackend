import { Module } from '@nestjs/common';
import { UserOtpService } from './user-otp.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserOtp } from './model/user-otp.entity';
import { UsersModule } from 'src/users/users.module';
// import { MailerModule } from '@nestjs-modules/mailer';
import { MailSenderService } from './mail-sender.service';
import { MobileSenderService } from './mobile-sender.service';
import { OperationalMetric } from '../monitoring/entities/operational-metric.entity';

@Module({
  imports: [UsersModule, TypeOrmModule.forFeature([UserOtp, OperationalMetric])],
  providers: [UserOtpService, MailSenderService, MobileSenderService],
  exports: [UserOtpService, MailSenderService, MobileSenderService],
  controllers: [],
})
export class UserOtpModule {}

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OtpType } from './model/otp-type.enum';
import { UserOtp } from './model/user-otp.entity';
import { LessThan, Not, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { UsersService } from 'src/users/services/users.service';
import { StandardResponse } from 'src/common/module/standard-response';
import { MailSenderService } from './mail-sender.service';
import { MobileSenderService } from './mobile-sender.service';
import { randomInt, timingSafeEqual } from 'crypto';
import { OtpPurpose } from './model/otp-purpose.enum';

const MAX_FAILED_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60_000;

@Injectable() // sending email otp, sending mobile otp, verifying otp
export class UserOtpService {
  constructor(
    @InjectRepository(UserOtp)
    private readonly userOtpRepository: Repository<UserOtp>,
    private readonly userService: UsersService,
    private readonly mailSenderService: MailSenderService,
    private readonly mobileSenderService: MobileSenderService,
  ) {}

  async sendOTP(
    otpType: OtpType,
    reference: string,
    purpose = OtpPurpose.VERIFICATION,
    userId?: string,
    scope?: string,
  ) {
    const user = userId
      ? await this.userService.findAuthUserById(userId)
      : await this.userService.findByEmailOrMobile(reference);
    if (!user) {
      throw new BadRequestException(
        new StandardResponse(true, 'USER_NOT_FOUND'),
      );
    }
    if (otpType == OtpType.EMAIL) {
      if (user.email != reference) {
        throw new BadRequestException(
          new StandardResponse(true, 'INVALID_EMAIL_REFERENCE'),
        );
      }

      await this.createAndDeliverOTP(
        user.id,
        otpType,
        reference,
        this.getPurposeKey(purpose, scope),
        (otp) =>
          this.sendMail(reference, otp, `${user.firstName} ${user.lastName}`),
      );
    } else if (otpType == OtpType.MOBILE) {
      if (user.mobile != reference) {
        throw new BadRequestException(
          new StandardResponse(true, 'INVALID_MOBILE_REFERENCE'),
        );
      }

      await this.createAndDeliverOTP(
        user.id,
        otpType,
        reference,
        this.getPurposeKey(purpose, scope),
        (otp) =>
          this.mobileSenderService.sendSms(
            reference,
            otp,
            user.callingCode,
            purpose,
            `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          ),
      );
    } else {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_REFERENCE'),
      );
    }
  }

  /**
   * Send OTP for a specific user - accepts userId directly instead of looking up by email.
   * Used for admin login where we need to ensure the OTP is created with the correct userId.
   */
  async sendOTPForUser(userId: string, email: string, userName: string) {
    return this.createAndDeliverOTP(
      userId,
      OtpType.EMAIL,
      email,
      OtpPurpose.ADMIN_LOGIN,
      (otp) => this.sendMail(email, otp, userName),
    );
  }

  private async createAndDeliverOTP(
    userId: string,
    otpType: OtpType,
    reference: string,
    purpose: string,
    deliver: (otp: number) => Promise<unknown>,
  ) {
    const newUserOtp = await this.userOtpRepository.manager.transaction(
      async (manager) => {
        // Serializes issuance per user/type/purpose across every API instance.
        const [lock] = await manager.query(
          'SELECT pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) AS acquired',
          [userId, `${otpType}:${purpose}`],
        );
        if (!lock?.acquired) {
          throw new HttpException(
            new StandardResponse(true, 'OTP_REQUEST_IN_PROGRESS'),
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        const existing = await manager.findOne(UserOtp, {
          where: { userId, otpType, purpose },
          order: { dateCreated: 'DESC' },
        });
        if (
          existing &&
          Date.now() - existing.dateCreated.getTime() < OTP_RESEND_COOLDOWN_MS
        ) {
          throw new HttpException(
            new StandardResponse(true, 'OTP_RESEND_TOO_SOON'),
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        const otp = randomInt(1000, 10000);
        const expiryDate = new Date(Date.now() + 30 * 60 * 1000);
        const pendingOtp = new UserOtp();
        pendingOtp.otp = otp.toString();
        pendingOtp.userId = userId;
        pendingOtp.reference = reference;
        pendingOtp.otpType = otpType;
        pendingOtp.purpose = purpose;
        pendingOtp.isActive = false;
        pendingOtp.expiryDate = expiryDate;
        pendingOtp.used = false;
        pendingOtp.failedAttempts = 0;

        await manager.save(UserOtp, pendingOtp);
        return pendingOtp;
      },
    );

    let delivered: unknown;
    try {
      delivered = await deliver(Number(newUserOtp.otp));
    } catch {
      delivered = null;
    }
    if (!delivered) {
      await this.userOtpRepository.delete(newUserOtp.id);
      throw new ServiceUnavailableException(
        new StandardResponse(true, 'OTP_DELIVERY_FAILED'),
      );
    }

    try {
      await this.userOtpRepository.manager.transaction(async (manager) => {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
          [userId, `${otpType}:${purpose}`],
        );
        await manager.delete(UserOtp, {
          userId,
          otpType,
          purpose,
          id: Not(newUserOtp.id),
        });
        const activation = await manager.update(
          UserOtp,
          { id: newUserOtp.id, isActive: false },
          { isActive: true },
        );
        if (activation.affected !== 1) {
          throw new ServiceUnavailableException(
            new StandardResponse(true, 'OTP_ACTIVATION_FAILED'),
          );
        }
      });
    } catch (error) {
      await this.userOtpRepository.delete(newUserOtp.id);
      throw error;
    }
    return Number(newUserOtp.otp);
  }

  async verifyOTP(
    otp: string,
    reference: string,
    userId: string,
    otpType: OtpType,
    use: boolean,
    purpose = OtpPurpose.VERIFICATION,
    scope?: string,
  ) {
    if (!otp) {
      throw new BadRequestException(
        new StandardResponse(true, 'OTP_IS_REQUIRED'),
      );
    }
    const userOtp = await this.userOtpRepository.findOne({
      where: {
        reference,
        userId,
        otpType,
        purpose: this.getPurposeKey(purpose, scope),
        isActive: true,
      },
    });

    if (!userOtp) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_OR_EXPIRED_OTP'),
      );
    }

    if (userOtp.used) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_OR_EXPIRED_OTP'),
      );
    }

    const currentDate = new Date();

    if (currentDate > userOtp.expiryDate) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_OR_EXPIRED_OTP'),
      );
    }

    if (userOtp.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      throw new BadRequestException(
        new StandardResponse(true, 'OTP_ATTEMPTS_EXCEEDED'),
      );
    }

    const supplied = Buffer.from(otp);
    const expected = Buffer.from(userOtp.otp);
    const matches =
      supplied.length === expected.length &&
      timingSafeEqual(supplied, expected);
    if (!matches) {
      const result = await this.userOtpRepository.increment(
        {
          id: userOtp.id,
          used: false,
          failedAttempts: LessThan(MAX_FAILED_ATTEMPTS),
        },
        'failedAttempts',
        1,
      );
      if (result.affected !== 1) {
        throw new BadRequestException(
          new StandardResponse(true, 'OTP_ATTEMPTS_EXCEEDED'),
        );
      }
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_OR_EXPIRED_OTP'),
      );
    }

    if (use) {
      const result = await this.userOtpRepository.update(
        { id: userOtp.id, used: false },
        { used: true },
      );

      if (result.affected !== 1) {
        throw new BadRequestException(
          new StandardResponse(true, 'OTP_HAS_BEEN_USED'),
        );
      }
    }
  }

  private getPurposeKey(purpose: OtpPurpose, scope?: string) {
    return scope ? `${purpose}:${scope}` : purpose;
  }

  async sendMail(email: string, content: number, name?: string) {
    return this.mailSenderService.sendMail({
      recipient: email,
      subject: 'Cushy Access OTP',
      content: {
        otp: content,
        name: name || 'User',
        currentYear: new Date().getFullYear(),
      },
      template: 'otp',
    });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from 'src/users/model/users.entity';
import { In, Repository } from 'typeorm';
import { VendorVerificationDto } from '../dto/vendor-verification.dto';
import { StandardResponse } from 'src/common/module/standard-response';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { AdminRole } from 'src/users/model/admin-roles.enum';
import * as bcrypt from 'bcryptjs';
import { EventBus } from '@nestjs/cqrs';
import { PushNotificationEvent } from 'src/users/events/push-notification.event';
import { NotificationCategory } from 'src/users/model/notification-category';
import { MailSenderService } from 'src/user-otp/mail-sender.service';
import { Stores } from 'src/stores/model/stores.entity';
import { UserCredentials } from 'src/users/model/user-credentials.entity';
import { UserCredentialStatus } from 'src/users/model/user-credential.enum';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(Users) private userRepository: Repository<Users>,
    @InjectRepository(Stores) private storeRepository: Repository<Stores>,
    @InjectRepository(UserCredentials)
    private userCredentialsRepository: Repository<UserCredentials>,
    private readonly eventBus: EventBus,
    private readonly mailSenderService: MailSenderService,
  ) {}

  async updateVendorVerificationStatus(
    vendorId: string,
    verificationFlag: VendorVerificationDto,
  ): Promise<StandardResponse> {
    let vendor: Users | null = null;
    let primaryStore: Stores | null = null;
    let notificationCategory: NotificationCategory;
    let pushMessage: string;
    let emailSubject: string;
    let verificationStatus: UserCredentialStatus;
    let rejectionReason: string | null = null;

    if (verificationFlag.status === UserCredentialStatus.APPROVED) {
      verificationStatus = UserCredentialStatus.APPROVED;
      notificationCategory = NotificationCategory.VENDOR_CREDENTIAL_APPROVED;
      pushMessage = `Your vendor profile has been approved! You can now start listing your products on the platform.`;
      emailSubject = 'Congratulations! Your Vendor Profile Has Been Approved';
    } else if (verificationFlag.status === UserCredentialStatus.REJECTED) {
      rejectionReason = verificationFlag.reason || 'No reason provided';
      verificationStatus = UserCredentialStatus.REJECTED;
      notificationCategory = NotificationCategory.VENDOR_CREDENTIAL_REJECTED;
      pushMessage = `Your verification request was not approved. Reason: ${rejectionReason}`;
      emailSubject = 'Update Regarding Your Vendor Verification Request';
    } else {
      return new StandardResponse(true, 'INVALID_STATUS', {});
    }

    const approved = verificationStatus === UserCredentialStatus.APPROVED;
    let credentialsMissing = false;

    await this.userRepository.manager.transaction(async (manager) => {
      const usersRepository = manager.getRepository(Users);
      const credentialsRepository = manager.getRepository(UserCredentials);
      const storesRepository = manager.getRepository(Stores);

      vendor = await usersRepository.findOne({
        where: {
          id: vendorId,
          userRole: UserRoles.VENDOR,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!vendor) return;

      const credentials = await credentialsRepository.findOne({
        where: { userId: vendorId },
      });

      if (approved && !credentials) {
        credentialsMissing = true;
        return;
      }

      if (credentials) {
        credentials.status = verificationStatus;
        credentials.reason = rejectionReason;
        await credentialsRepository.save(credentials);
      }

      await usersRepository.update(vendorId, {
        isVerified: approved,
        verificationStatus,
        verificationReason: rejectionReason,
      });

      // Customer discovery reads verification from the store row. Keep all of
      // a multi-store vendor's rows synchronized with KYC, and ensure a
      // rejected merchant cannot remain Featured.
      await storesRepository.update(
        { userId: vendorId },
        approved
          ? { isVerified: true }
          : {
              isVerified: false,
              isFeatured: false,
              featuredAt: null,
            },
      );

      primaryStore = await storesRepository.findOne({
        where: { userId: vendorId },
        order: { name: 'ASC' },
      });
    });

    if (!vendor) {
      return new StandardResponse(true, 'VENDOR_NOT_FOUND', {});
    }
    if (credentialsMissing) {
      return new StandardResponse(true, 'CREDENTIALS_NOT_FOUND', {});
    }

    this.eventBus.publish(
      new PushNotificationEvent(vendor.id, notificationCategory, pushMessage),
    );

    const emailContent = {
      vendorName: `${vendor.firstName} ${vendor.lastName}`,
      storeName: primaryStore?.name || 'Your Store',
      verificationDate: new Date().toLocaleDateString(),
      storeCategory: primaryStore?.category || 'N/A',
      status: verificationStatus,
      rejectionReason,
      dashboardUrl:
        'https://play.google.com/store/search?q=CushyAccess&c=apps&hl=en',
    };

    try {
      await this.mailSenderService.sendMail({
        recipient: vendor.email,
        subject: emailSubject,
        template: 'vendor-verification',
        content: emailContent,
      });
    } catch (error) {
      // The database transaction already committed. Do not report a false
      // verification failure (and invite a retry) for an email provider outage.
      this.logger.error(
        `Vendor verification email failed for ${vendorId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return new StandardResponse(
      false,
      'VENDOR_VERIFICATION_STATUS_UPDATED_SUCCESSFULLY',
      {},
    );
  }

  async updateUserRole(
    userId: string,
    newRole: UserRoles,
  ): Promise<StandardResponse> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (!user) {
      return new StandardResponse(true, 'USER_NOT_FOUND', {});
    }
    user.userRole = newRole;
    await this.userRepository.save(user);
    return new StandardResponse(false, 'USER_ROLE_UPDATED_SUCCESSFULLY', {});
  }

  async updateAdminRole(
    userId: string,
    adminRole: AdminRole,
  ): Promise<StandardResponse> {
    const user = await this.userRepository.findOne({
      where: { id: userId, userRole: UserRoles.ADMIN },
    });
    if (!user) {
      return new StandardResponse(true, 'ADMIN_USER_NOT_FOUND', {});
    }
    user.adminRole = adminRole;
    await this.userRepository.save(user);
    return new StandardResponse(false, 'ADMIN_ROLE_UPDATED_SUCCESSFULLY', {});
  }

  async createAdmin(
    firstName: string,
    lastName: string,
    email: string,
    password: string,
    mobile: string,
    adminRole: AdminRole,
  ): Promise<StandardResponse> {
    // Check if email already exists
    const existingUser = await this.userRepository.findOne({
      where: { email },
    });
    if (existingUser) {
      return new StandardResponse(true, 'EMAIL_ALREADY_EXISTS', {});
    }

    const saltOrRounds = 10;
    const hash = await bcrypt.hash(password, saltOrRounds);

    const newAdmin = new Users();
    newAdmin.firstName = firstName;
    newAdmin.lastName = lastName;
    newAdmin.email = email;
    newAdmin.password = hash;
    newAdmin.mobile = mobile;
    newAdmin.userRole = UserRoles.ADMIN;
    newAdmin.adminRole = adminRole;

    await this.userRepository.save(newAdmin);

    return new StandardResponse(false, 'ADMIN_CREATED_SUCCESSFULLY', {
      id: newAdmin.id,
      firstName: newAdmin.firstName,
      lastName: newAdmin.lastName,
      email: newAdmin.email,
      adminRole: newAdmin.adminRole,
    });
  }

  async getAllAdmins(): Promise<StandardResponse> {
    const admins = await this.userRepository.find({
      where: { userRole: UserRoles.ADMIN },
      select: [
        'id',
        'firstName',
        'lastName',
        'email',
        'mobile',
        'adminRole',
        'createdAt',
      ],
      order: { createdAt: 'DESC' },
    });

    return new StandardResponse(false, 'ADMINS_FETCHED_SUCCESSFULLY', admins);
  }

  async resetAdminPassword(
    userId: string,
    newPassword: string,
  ): Promise<StandardResponse> {
    const user = await this.userRepository.findOne({
      where: { id: userId, userRole: UserRoles.ADMIN },
    });
    if (!user) {
      return new StandardResponse(true, 'ADMIN_USER_NOT_FOUND', {});
    }

    const saltOrRounds = 10;
    const hash = await bcrypt.hash(newPassword, saltOrRounds);
    user.password = hash;
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    await this.userRepository.save(user);

    return new StandardResponse(false, 'PASSWORD_RESET_SUCCESSFULLY', {});
  }

  async deleteAdmin(
    userId: string,
    requestingUserId: string,
  ): Promise<StandardResponse> {
    if (userId === requestingUserId) {
      return new StandardResponse(true, 'CANNOT_DELETE_OWN_ACCOUNT', {});
    }

    const user = await this.userRepository.findOne({
      where: { id: userId, userRole: UserRoles.ADMIN },
    });
    if (!user) {
      return new StandardResponse(true, 'ADMIN_USER_NOT_FOUND', {});
    }

    await this.userRepository.remove(user);

    return new StandardResponse(false, 'ADMIN_DELETED_SUCCESSFULLY', {});
  }
  async adminMerchants(): Promise<StandardResponse> {
    const merchants = await this.userRepository.find({
      where: { userRole: UserRoles.VENDOR },
      relations: ['wallet', 'store', 'store.address'],
      order: { createdAt: 'DESC' },
    });

    const merchantIds = merchants.map((m) => m.id);

    const credentials = await this.userCredentialsRepository.find({
      where: { userId: In(merchantIds) },
    });

    const credentialsByUserId = new Map(credentials.map((c) => [c.userId, c]));

    const sanitized = merchants.map((merchant) => {
      const { wallet, ...rest } = merchant;
      delete rest.password;
      return {
        ...rest,
        walletBalance: Number(wallet?.walletBalance || 0),
        credentials: credentialsByUserId.get(rest.id) ?? null,
      };
    });

    return new StandardResponse(false, 'MERCHANTS_FETCHED_SUCCESSFULLY', {
      merchants: sanitized,
    });
  }
}

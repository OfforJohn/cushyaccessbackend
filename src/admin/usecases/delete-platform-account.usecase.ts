import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { StandardResponse } from 'src/common/module/standard-response';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { Users } from 'src/users/model/users.entity';
import { UserLocations } from 'src/users/model/user-locations.entity';
import { UserCredentials } from 'src/users/model/user-credentials.entity';
import { PayoutTransactions } from 'src/users/model/payout-transactions.entity';
import { VendorPayoutDetails } from 'src/users/model/vendor-payout.entity';
import { UserOtp } from 'src/user-otp/model/user-otp.entity';
import { ApiKeys } from 'src/api-keys/api-keys.entity';
import { Conversation } from 'src/cushy-ai/model/entity/conversation.entity';
import { AiChat } from 'src/cushy-ai/model/entity/ai-chat.entity';
import { Wallets } from 'src/wallet/model/wallet.entity';
import { Transactions } from 'src/wallet/model/transaction.entity';
import { ManualFunding } from 'src/wallet/model/manual-funding.entity';
import { VirtualAccounts } from 'src/wallet/model/virtual-account.entity';
import { BankAccounts } from 'src/wallet/model/bank-account.entity';
import { CreditCards } from 'src/wallet/model/credit-card.entity';
import { WalletNotifications } from 'src/wallet/model/notification.entity';
import { Rider } from 'src/riders/model/rider.entity';
import { RiderDocument } from 'src/riders/model/rider-document.entity';
import { Stores } from 'src/stores/model/stores.entity';
import { MenuItem } from 'src/stores/model/menu-item.entity';
import { OpeningSchedule } from 'src/stores/model/opening-schedule.entity';
import { DaySchedule } from 'src/stores/model/day-schedules';
import { PaymentInfo } from 'src/stores/model/payment-info.entity';
import { ProfessionDetails } from 'src/doctor/models/professional-details.entity';
import { Appointment } from 'src/doctor/models/appointment.entity';
import { Prescription } from 'src/doctor/models/prescription.entity';
import { DoctorSignature } from 'src/doctor/models/doctor-signature.entity';
import { ConsultationSchedule } from 'src/doctor/models/consultation-schedule.entity';
import { CouponRedemption } from 'src/promo-code/model/coupon-redemption.entity';
import { PromoCodes } from 'src/promo-code/model/promo-code.entity';
import { S3Service } from 'src/utils/s3-bucket.service';
import { deleteFilesBestEffort } from 'src/utils/uploaded-file.util';
import { UsersService } from 'src/users/services/users.service';
import { lockRiderDocumentMutation } from 'src/riders/rider-document-lock';

const DELETABLE_ROLES = new Set<UserRoles>([
  UserRoles.CUSTOMER,
  UserRoles.RIDER,
  UserRoles.VENDOR,
  UserRoles.DOCTOR,
]);

interface DeletionSnapshot {
  role: UserRoles;
  email: string;
  mobile: string;
  storageUrls: string[];
}

@Injectable()
export class DeletePlatformAccountUseCase {
  private readonly logger = new Logger(DeletePlatformAccountUseCase.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly s3Service: S3Service,
    private readonly usersService: UsersService,
  ) {}

  async execute(
    userId: string,
    confirmationEmail: string,
  ): Promise<StandardResponse> {
    const snapshot = await this.dataSource.transaction((manager) =>
      this.deleteDatabaseRecords(manager, userId, confirmationEmail),
    );

    await this.usersService.invalidateUserCaches({
      id: userId,
      email: snapshot.email,
      mobile: snapshot.mobile,
    });
    const uniqueUrls = [...new Set(snapshot.storageUrls.filter(Boolean))];
    const failedStorageUrls = await deleteFilesBestEffort(
      this.s3Service,
      uniqueUrls,
    );
    const storageCleanupFailures = failedStorageUrls.length;
    if (storageCleanupFailures > 0) {
      this.logger.warn(
        `Account ${userId} deleted; ${storageCleanupFailures} of ${uniqueUrls.length} storage objects could not be removed`,
      );
    }

    return new StandardResponse(false, 'PLATFORM_ACCOUNT_DELETED', {
      userId,
      role: snapshot.role,
      databaseDeleted: true,
      storageObjectsFound: uniqueUrls.length,
      storageCleanupFailures,
    });
  }

  private async deleteDatabaseRecords(
    manager: EntityManager,
    userId: string,
    confirmationEmail: string,
  ): Promise<DeletionSnapshot> {
    const user = await manager.findOne(Users, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user) {
      throw new NotFoundException(new StandardResponse(true, 'USER_NOT_FOUND'));
    }
    if (!DELETABLE_ROLES.has(user.userRole)) {
      throw new BadRequestException(
        new StandardResponse(true, 'ACCOUNT_ROLE_CANNOT_BE_DELETED_HERE'),
      );
    }
    if (
      user.email.trim().toLowerCase() !== confirmationEmail.trim().toLowerCase()
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'ACCOUNT_DELETE_CONFIRMATION_MISMATCH'),
      );
    }

    const storageUrls = new Set<string>();
    this.addUrls(storageUrls, [
      user.profilePic,
      user.businessRegistration,
      user.governmentId,
    ]);
    const locationCandidates = new Set<string>();
    if (user.locationId) locationCandidates.add(user.locationId);
    const createdLocations = await manager.find(UserLocations, {
      where: { addedBy: userId },
      select: { id: true },
    });
    createdLocations.forEach((location) => locationCandidates.add(location.id));

    // Remove every owned graph rather than trusting the current role alone.
    // This also cleans legacy data left behind if an account's role changed.
    await this.deleteRider(manager, userId, storageUrls);
    await this.deleteMerchant(manager, userId, storageUrls, locationCandidates);
    await this.deleteHealthProfessional(manager, userId, storageUrls);

    await manager.delete(UserCredentials, { userId });
    await manager.delete(PaymentInfo, { userId });
    await manager
      .createQueryBuilder()
      .delete()
      .from(VendorPayoutDetails)
      .where('"userId" = :userId', { userId })
      .execute();
    await manager
      .createQueryBuilder()
      .delete()
      .from(PayoutTransactions)
      .where('"vendorId" = :userId', { userId })
      .execute();

    await manager.delete(ManualFunding, { userId });
    await manager.delete(WalletNotifications, { userId });
    await manager.delete(CreditCards, { userId });
    await manager.delete(BankAccounts, { userId });
    await manager.delete(VirtualAccounts, { userId });
    await manager.delete(Transactions, { userId });
    await manager.delete(Wallets, { userId });

    await manager.delete(CouponRedemption, { userId });
    await manager.delete(PromoCodes, { ambassadorId: userId });
    await manager.delete(UserOtp, { userId });
    await manager.delete(ApiKeys, { userId });
    await manager.delete(AiChat, { userId });
    await manager.delete(Conversation, { userId });

    const deleteResult = await manager.delete(Users, { id: userId });
    if (deleteResult.affected !== 1) {
      throw new NotFoundException(new StandardResponse(true, 'USER_NOT_FOUND'));
    }

    for (const locationId of locationCandidates) {
      const [remainingUsers, remainingStores] = await Promise.all([
        manager.count(Users, { where: { locationId } }),
        manager.count(Stores, { where: { addressId: locationId } }),
      ]);
      if (remainingUsers === 0 && remainingStores === 0) {
        await manager.delete(UserLocations, { id: locationId });
      }
    }

    return {
      role: user.userRole,
      email: user.email,
      mobile: user.mobile,
      storageUrls: [...storageUrls],
    };
  }

  private async deleteRider(
    manager: EntityManager,
    userId: string,
    storageUrls: Set<string>,
  ): Promise<void> {
    const rider = await manager.findOne(Rider, { where: { userId } });
    if (!rider) return;
    await lockRiderDocumentMutation(manager, rider.id);
    const documents = await manager.find(RiderDocument, {
      where: { riderId: rider.id },
    });
    this.addUrls(storageUrls, [
      rider.profilePhoto,
      rider.deliveryBagPhoto,
      ...documents.map((document) => document.documentUrl),
    ]);
    await manager.delete(Rider, { id: rider.id });
  }

  private async deleteMerchant(
    manager: EntityManager,
    userId: string,
    storageUrls: Set<string>,
    locationCandidates: Set<string>,
  ): Promise<void> {
    const [credentials, stores] = await Promise.all([
      manager.findOne(UserCredentials, { where: { userId } }),
      manager.find(Stores, { where: { userId } }),
    ]);
    if (credentials) {
      this.addUrls(storageUrls, [
        credentials.cacURL,
        credentials.governmentId,
        credentials.proofOfAddressURL,
        credentials.pharmacyLicenseURL,
      ]);
    }
    const storeIds = stores.map((store) => store.id);
    this.addUrls(
      storageUrls,
      stores.map((store) => store.coverImage),
    );
    stores.forEach((store) => {
      if (store.addressId) locationCandidates.add(store.addressId);
    });
    if (storeIds.length > 0) {
      const items = await manager.find(MenuItem, {
        where: { storeId: In(storeIds) },
      });
      this.addUrls(
        storageUrls,
        items.flatMap((item) => item.images || []),
      );
    }

    const openingSchedules = await manager.find(OpeningSchedule, {
      where: { userId },
    });
    const scheduleIds = openingSchedules.map((schedule) => schedule.id);
    if (scheduleIds.length > 0) {
      await manager.delete(DaySchedule, {
        openingScheduleId: In(scheduleIds),
      });
    }
    await manager.delete(OpeningSchedule, { userId });
    await manager.delete(Stores, { userId });
  }

  private async deleteHealthProfessional(
    manager: EntityManager,
    userId: string,
    storageUrls: Set<string>,
  ): Promise<void> {
    const [profession, signatures, prescriptions] = await Promise.all([
      manager.findOne(ProfessionDetails, { where: { userId } }),
      manager.find(DoctorSignature, { where: { doctorId: userId } }),
      manager
        .getRepository(Prescription)
        .createQueryBuilder('prescription')
        .where('prescription.doctorId = :userId', { userId })
        .orWhere('prescription.patientId = :userId', { userId })
        .getMany(),
    ]);
    if (profession) {
      this.addUrls(storageUrls, [
        profession.medicalLicense,
        profession.governmentId,
        profession.professionalCertificate,
      ]);
    }
    this.addUrls(
      storageUrls,
      signatures.map((signature) => signature.signatureUrl),
    );
    this.addUrls(
      storageUrls,
      prescriptions.map((prescription) => prescription.signatureUrl),
    );

    await manager
      .createQueryBuilder()
      .delete()
      .from(Prescription)
      .where('"doctorId" = :userId OR "patientId" = :userId', { userId })
      .execute();
    await manager
      .createQueryBuilder()
      .delete()
      .from(Appointment)
      .where('"doctorId" = :userId OR "patientId" = :userId', { userId })
      .execute();
    await manager.delete(DoctorSignature, { doctorId: userId });
    await manager.delete(ConsultationSchedule, { doctorId: userId });
    await manager.delete(ProfessionDetails, { userId });
  }

  private addUrls(target: Set<string>, urls: Array<string | null | undefined>) {
    urls.forEach((url) => {
      if (typeof url === 'string' && url.trim()) target.add(url.trim());
    });
  }
}

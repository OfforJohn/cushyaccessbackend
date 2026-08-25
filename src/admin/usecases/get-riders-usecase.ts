import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { StandardResponse } from 'src/common/module/standard-response';
import { Rider } from 'src/riders/model/rider.entity';
import {
  DocumentStatus,
  DocumentType,
} from 'src/riders/model/rider-document.entity';
import { Repository } from 'typeorm';
import { getRiderOrderOfferConfig } from '../../riders/rider-order-offer.config';

@Injectable()
export class GetRiderUseCase {
  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
  ) {}

  async execute() {
    const { maxLocationAgeMinutes } = getRiderOrderOfferConfig();
    const freshLocationThreshold = Date.now() - maxLocationAgeMinutes * 60_000;
    const riders = await this.riderRepository
      .createQueryBuilder('rider')
      .leftJoin('rider.user', 'rider_user')
      .addSelect([
        'rider_user.id',
        'rider_user.firstName',
        'rider_user.lastName',
        'rider_user.email',
        'rider_user.mobile',
        'rider_user.dateOfBirth',
        'rider_user.profilePic',
        'rider_user.locationId',
      ])
      .leftJoin('rider_user.location', 'rider_location')
      .addSelect([
        'rider_location.id',
        'rider_location.address',
        'rider_location.city',
        'rider_location.state',
        'rider_location.country',
      ])
      .leftJoin('rider_user.onboardings', 'rider_onboarding')
      .addSelect([
        'rider_onboarding.id',
        'rider_onboarding.onboardingType',
      ])
      .leftJoin('rider.documents', 'rider_document')
      .addSelect([
        'rider_document.id',
        'rider_document.riderId',
        'rider_document.documentType',
        'rider_document.status',
      ])
      .orderBy('rider.createdAt', 'DESC')
      .getMany();

    const localRiders = riders.map((rider) => {
      const documents = rider.documents || [];
      const hasDocument = (type: DocumentType) =>
        documents.some(
          (document) =>
            document.documentType === type &&
            document.status === DocumentStatus.VERIFIED,
        );
      const name =
        `${rider.user?.firstName || ''} ${rider.user?.lastName || ''}`.trim();
      const hasFreshLocation =
        rider.lastLocationUpdate != null &&
        new Date(rider.lastLocationUpdate).getTime() >= freshLocationThreshold;
      const hasVerifiedMobile = rider.user?.onboardings?.some(
        (onboarding) => onboarding.onboardingType === 'MOBILE_VERIFIED',
      );

      return {
        id: rider.id,
        riderId: rider.id,
        userId: rider.userId,
        name: name || 'Unnamed Rider',
        fullName: name || 'Unnamed Rider',
        firstName: rider.user?.firstName || '',
        lastName: rider.user?.lastName || '',
        phone: rider.user?.mobile || '',
        phoneNumber: rider.user?.mobile || '',
        email: rider.user?.email || '',
        dateOfBirth: rider.user?.dateOfBirth || null,
        profilePhoto: rider.profilePhoto || rider.user?.profilePic || null,
        isVerified: Boolean(hasVerifiedMobile),
        address: rider.user?.location?.address || null,
        city: rider.user?.location?.city || null,
        state: rider.user?.location?.state || null,
        country: rider.user?.location?.country || null,
        status: rider.status,
        isActive: rider.status === 'active',
        isOnline:
          rider.isOnline && rider.status === 'active' && hasFreshLocation,
        vehicleType: rider.bikeType,
        vehicleModel: [rider.bikeBrand, rider.bikeModel]
          .filter(Boolean)
          .join(' '),
        vehicleColor: rider.bikeColor,
        vehicleId: rider.licensePlate,
        licensePlate: rider.licensePlate,
        rating: Number(rider.rating) || 0,
        totalDeliveries: rider.totalDeliveries || 0,
        totalEarnings: Number(rider.totalEarnings) || 0,
        trainingCompleted: Boolean(rider.trainingCompleted),
        backgroundCheckStatus: rider.backgroundCheckStatus || 'pending',
        bankName: rider.bankName,
        accountNumber: rider.accountNumber,
        accountName: rider.accountHolderName,
        hasProfilePhoto: Boolean(rider.profilePhoto || rider.user?.profilePic),
        hasNIN: hasDocument(DocumentType.ID_CARD),
        hasLicense: hasDocument(DocumentType.DRIVING_LICENSE),
        hasVehiclePapers: hasDocument(DocumentType.BIKE_REGISTRATION),
        documents: documents.map((document) => ({
          id: document.id,
          type: document.documentType,
          status: document.status,
        })),
        createdAt: rider.createdAt,
        updatedAt: rider.updatedAt,
      };
    });

    return new StandardResponse(
      false,
      'Riders fetched successfully',
      localRiders,
    );
  }
}

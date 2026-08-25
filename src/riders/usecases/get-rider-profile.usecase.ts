import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rider } from '../model/rider.entity';
import { DocumentStatus } from '../model/rider-document.entity';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { UserRoles } from 'src/users/model/user-roles.enum';

@Injectable()
export class GetRiderProfileUseCase {
  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,

    private readonly commonService: CommonService,
  ) {}

  async execute(): Promise<StandardResponse> {
    // Get the authenticated user
    const authenticatedUser = await this.commonService.getLoggedInUser();

    // Find the rider with all relations
    const rider = await this.riderRepository.findOne({
      where: { userId: authenticatedUser.id },
      relations: ['user', 'documents'],
    });

    if (!rider) {
      throw new NotFoundException(
        new StandardResponse(true, 'RIDER_NOT_FOUND'),
      );
    }

    const isOwnProfile = rider.userId === authenticatedUser.id;
    const isAdmin = authenticatedUser.userRole === UserRoles.ADMIN;

    if (!isOwnProfile && !isAdmin) {
      throw new NotFoundException(
        new StandardResponse(true, 'UNAUTHORIZED_ACCESS'),
      );
    }

    // The relation is already loaded; deriving counts here avoids a second query
    // and keeps every count a number rather than a Postgres COUNT string.
    const documentsVerified =
      rider.documents?.filter(
        (document) => document.status === DocumentStatus.VERIFIED,
      ).length || 0;
    const documentsPending =
      rider.documents?.filter(
        (document) => document.status === DocumentStatus.PENDING,
      ).length || 0;
    const documentsRejected =
      rider.documents?.filter(
        (document) => document.status === DocumentStatus.REJECTED,
      ).length || 0;
    const totalDocuments =
      documentsVerified + documentsPending + documentsRejected;

    // Calculate profile completion percentage
    const profileCompletion = this.calculateProfileCompletion(rider);

    // Prepare the response with formatted data
    const profileData = {
      // Basic Info
      riderId: rider.id,
      status: rider.status,
      payoutSchedule: rider.payoutSchedule,

      // Personal Information
      personalInfo: {
        firstName: rider.user?.firstName,
        lastName: rider.user?.lastName,
        email: rider.user?.email,
        phoneNumber: rider.user?.mobile,
        profilePhoto: rider.profilePhoto,
        dateJoined: rider.createdAt,
      },

      // Bike Information
      bikeInfo: {
        bikeType: rider.bikeType,
        bikeBrand: rider.bikeBrand,
        bikeModel: rider.bikeModel,
        bikeColor: rider.bikeColor,
        bikeYear: rider.bikeYear,
        licensePlate: rider.licensePlate,
        engineDisplacement: rider.engineDisplacement,
        hasHelmet: rider.hasHelmet,
        hasPhoneMount: rider.hasPhoneMount,
        hasDeliveryBag: rider.hasDeliveryBag,
        deliveryBagPhoto: rider.deliveryBagPhoto,
      },

      // License Information
      licenseInfo: {
        licenseNumber: rider.licenseNumber,
        licenseClass: rider.licenseClass,
        licenseExpiryDate: rider.licenseExpiryDate,
        licenseIssuingAuthority: rider.licenseIssuingAuthority,
        isLicenseValid: rider.licenseExpiryDate
          ? new Date(rider.licenseExpiryDate) > new Date()
          : false,
      },

      // Insurance Information
      insuranceInfo: {
        provider: rider.insuranceProvider,
        policyNumber: rider.insurancePolicyNumber,
        expiryDate: rider.insuranceExpiryDate,
        isValid: rider.insuranceExpiryDate
          ? new Date(rider.insuranceExpiryDate) > new Date()
          : false,
      },

      // Bank Details
      bankDetails: {
        bankName: rider.bankName,
        accountNumber: this.maskAccountNumber(rider.accountNumber),
        accountHolderName: rider.accountHolderName,
        bankCode: rider.bankCode,
        isVerified: rider.bankDetailsVerified,
      },

      // Emergency Contact
      emergencyContact: {
        name: rider.emergencyContactName,
        phone: rider.emergencyContactPhone,
        relationship: rider.emergencyContactRelation,
      },

      // Statistics
      stats: {
        rating: rider.rating,
        totalDeliveries: rider.totalDeliveries,
        totalEarnings: rider.totalEarnings,
        acceptanceRate: rider.acceptanceRate,
        completionRate: rider.completionRate,
        onlineHours: rider.onlineHours,
      },

      // Current Status
      currentStatus: {
        isOnline: rider.isOnline,
        lastLocationUpdate: rider.lastLocationUpdate,
        currentLocation:
          rider.currentLatitude && rider.currentLongitude
            ? {
                latitude: rider.currentLatitude,
                longitude: rider.currentLongitude,
              }
            : null,
      },

      // Verification Status
      verificationStatus: {
        backgroundCheck: rider.backgroundCheckStatus,
        backgroundCheckCompletedAt: rider.backgroundCheckCompletedAt,
        documents: {
          total: totalDocuments,
          verified: documentsVerified,
          pending: documentsPending,
          rejected: documentsRejected,
        },
      },

      // Documents (detailed list)
      documents: rider.documents?.map((doc) => ({
        id: doc.id,
        type: doc.documentType,
        status: doc.status,
        url: doc.documentUrl,
        documentNumber: doc.documentNumber,
        expiryDate: doc.expiryDate,
        uploadedAt: doc.uploadedAt,
        verifiedAt: doc.verifiedAt,
        verificationNotes: doc.verificationNotes,
      })),

      // Profile Completion
      profileCompletion: {
        percentage: profileCompletion.percentage,
        missingItems: profileCompletion.missingItems,
        nextSteps: profileCompletion.nextSteps,
      },

      // Metadata
      metadata: rider.metadata,
      rejectedReason: rider.rejectedReason,
      approvedAt: rider.approvedAt,
    };

    return new StandardResponse(
      false,
      'RIDER_PROFILE_FETCHED_SUCCESSFULLY',
      profileData,
    );
  }

  private calculateProfileCompletion(rider: Rider): {
    percentage: number;
    missingItems: string[];
    nextSteps: string[];
  } {
    const requiredFields = [
      { field: 'bikeType', weight: 5, label: 'Bike Type' },
      { field: 'bikeBrand', weight: 5, label: 'Bike Brand' },
      { field: 'bikeModel', weight: 5, label: 'Bike Model' },
      { field: 'bikeColor', weight: 3, label: 'Bike Color' },
      { field: 'bikeYear', weight: 3, label: 'Bike Year' },
      { field: 'licensePlate', weight: 5, label: 'License Plate' },
      { field: 'hasHelmet', weight: 5, label: 'Helmet' },
      { field: 'hasPhoneMount', weight: 3, label: 'Phone Mount' },
      { field: 'hasDeliveryBag', weight: 5, label: 'Delivery Bag' },
      { field: 'licenseNumber', weight: 10, label: 'License Number' },
      { field: 'licenseClass', weight: 5, label: 'License Class' },
      { field: 'licenseExpiryDate', weight: 5, label: 'License Expiry' },
      { field: 'profilePhoto', weight: 10, label: 'Profile Photo' },
      { field: 'bankName', weight: 5, label: 'Bank Name' },
      { field: 'accountNumber', weight: 5, label: 'Account Number' },
      { field: 'accountHolderName', weight: 5, label: 'Account Holder' },
      { field: 'bankCode', weight: 3, label: 'Bank Code' },
      { field: 'emergencyContactName', weight: 5, label: 'Emergency Contact' },
      { field: 'emergencyContactPhone', weight: 5, label: 'Emergency Phone' },
    ];

    const missingItems: string[] = [];
    let completedWeight = 0;
    let totalWeight = 0;

    requiredFields.forEach((item) => {
      totalWeight += item.weight;
      const value = rider[item.field as keyof Rider];

      if (value !== null && value !== undefined && value !== '') {
        // Special handling for boolean fields
        if (typeof value === 'boolean') {
          if (value === true) {
            completedWeight += item.weight;
          } else {
            missingItems.push(item.label);
          }
        } else {
          completedWeight += item.weight;
        }
      } else {
        missingItems.push(item.label);
      }
    });

    // Check documents
    if (!rider.documents || rider.documents.length === 0) {
      missingItems.push('Required Documents');
    } else {
      const requiredDocs = ['id_card', 'driving_license', 'bike_registration'];
      const uploadedDocTypes = rider.documents.map((d) => d.documentType);

      requiredDocs.forEach((docType) => {
        if (!uploadedDocTypes.includes(docType as any)) {
          missingItems.push(`${docType.replace('_', ' ')} document`);
        }
      });
    }

    const percentage = Math.round((completedWeight / totalWeight) * 100);

    // Generate next steps based on status and missing items
    const nextSteps: string[] = [];

    if (
      rider.status === 'pending' ||
      rider.status === 'document_verification'
    ) {
      nextSteps.push('Complete document upload and verification');
    }

    if (rider.backgroundCheckStatus !== 'approved') {
      nextSteps.push('Background check in progress');
    }

    if (missingItems.length > 0) {
      nextSteps.push(
        `Complete missing information: ${missingItems.slice(0, 3).join(', ')}`,
      );
    }

    return {
      percentage,
      missingItems,
      nextSteps: nextSteps.slice(0, 5), // Limit to 5 steps
    };
  }

  /**
   * Mask account number for security
   */
  private maskAccountNumber(accountNumber: string): string {
    if (!accountNumber) return null;

    const visibleDigits = 4;
    if (accountNumber.length <= visibleDigits) {
      return '*'.repeat(accountNumber.length);
    }

    const maskedPart = '*'.repeat(accountNumber.length - visibleDigits);
    const visiblePart = accountNumber.slice(-visibleDigits);
    return maskedPart + visiblePart;
  }
}

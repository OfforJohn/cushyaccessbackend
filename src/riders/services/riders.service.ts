import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, MoreThan } from 'typeorm';
import { EventBus } from '@nestjs/cqrs';
import { Rider, RiderStatus, BikeType } from '../model/rider.entity';
import {
  RiderDocument,
  DocumentType,
  DocumentStatus,
} from '../model/rider-document.entity';
import { UsersService } from '../../users/services/users.service';
import { WalletService } from '../../wallet/services/wallet.service';
import { CommonService } from '../../common/common.service';
import { StandardResponse } from '../../common/module/standard-response';
import { S3Service } from '../../utils/s3-bucket.service';
import { MailSenderService } from '../../user-otp/mail-sender.service';
import { getRiderOrderOfferConfig } from '../rider-order-offer.config';

@Injectable()
export class RiderService {
  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,

    @InjectRepository(RiderDocument)
    private readonly documentRepository: Repository<RiderDocument>,

    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,

    private readonly walletService: WalletService,
    private readonly commonService: CommonService,
    private readonly s3Service: S3Service,
    private readonly mailSenderService: MailSenderService,
    private readonly dataSource: DataSource,
    private readonly eventBus: EventBus,
  ) {}

  async findById(riderId: string): Promise<Rider> {
    const rider = await this.riderRepository.findOne({
      where: { id: riderId },
      relations: ['user', 'documents'],
    });

    if (!rider) {
      throw new NotFoundException(
        new StandardResponse(true, 'RIDER_NOT_FOUND'),
      );
    }

    return rider;
  }

  /**
   * Find rider by user ID
   */
  async findByUserId(userId: string): Promise<Rider | null> {
    return await this.riderRepository.findOne({
      where: { userId },
      relations: ['user', 'documents'],
    });
  }

  /**
   * Find all riders with pagination and filters
   */
  async findAll(
    page: number = 1,
    limit: number = 10,
    filters?: {
      status?: RiderStatus;
      isOnline?: boolean;
      bikeType?: BikeType;
      minRating?: number;
      search?: string;
      verified?: boolean;
    },
  ): Promise<{
    riders: Rider[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const queryBuilder = this.riderRepository
      .createQueryBuilder('rider')
      .leftJoinAndSelect('rider.user', 'user')
      .leftJoinAndSelect('rider.documents', 'documents')
      .orderBy('rider.createdAt', 'DESC');

    // Apply filters
    if (filters?.status) {
      queryBuilder.andWhere('rider.status = :status', {
        status: filters.status,
      });
    }

    if (filters?.isOnline !== undefined) {
      queryBuilder.andWhere('rider.isOnline = :isOnline', {
        isOnline: filters.isOnline,
      });
    }

    if (filters?.bikeType) {
      queryBuilder.andWhere('rider.bikeType = :bikeType', {
        bikeType: filters.bikeType,
      });
    }

    if (filters?.minRating) {
      queryBuilder.andWhere('rider.rating >= :minRating', {
        minRating: filters.minRating,
      });
    }

    if (filters?.verified !== undefined) {
      if (filters.verified) {
        queryBuilder.andWhere('rider.backgroundCheckStatus = :bgStatus', {
          bgStatus: 'approved',
        });
        queryBuilder.andWhere('rider.trainingCompleted = :training', {
          training: true,
        });
        queryBuilder.andWhere('rider.bankDetailsVerified = :bank', {
          bank: true,
        });
      }
    }

    if (filters?.search) {
      queryBuilder.andWhere(
        '(user.firstName ILIKE :search OR user.lastName ILIKE :search OR user.email ILIKE :search OR user.mobile ILIKE :search OR rider.licensePlate ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    // Pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const [riders, total] = await queryBuilder.getManyAndCount();
    const totalPages = Math.ceil(total / limit);

    return {
      riders,
      total,
      page,
      totalPages,
    };
  }

  /**
   * Find online riders near a location
   */
  async findNearbyRiders(
    latitude: number,
    longitude: number,
    radiusInKm: number = getRiderOrderOfferConfig().radiusKm,
    limit: number = 30,
    maxLocationAgeMinutes: number = 5,
  ): Promise<any[]> {
    // Using PostGIS for spatial query
    const query = `
      SELECT 
        r.id,
        r."userId",
        r."bikeType",
        r."bikeColor",
        r."licensePlate",
        r."rating",
        r."totalDeliveries",
        r."currentLatitude",
        r."currentLongitude",
        r."lastLocationUpdate",
        u."firstName" as "riderFirstName",
        u."lastName" as "riderLastName",
        ST_Distance(
          ST_MakePoint($1, $2)::geography,
          ST_MakePoint(r."currentLongitude", r."currentLatitude")::geography
        ) as distance
      FROM riders r
      LEFT JOIN users u ON r."userId" = u.id
      WHERE 
        r."isOnline" = true 
        AND r.status = 'active'
        AND r."trainingCompleted" = true
        AND r."backgroundCheckStatus" = 'approved'
        AND r."currentLatitude" IS NOT NULL
        AND r."currentLongitude" IS NOT NULL
        AND r."lastLocationUpdate" IS NOT NULL
        AND r."lastLocationUpdate" >= NOW() - ($5 * INTERVAL '1 minute')
        AND NOT EXISTS (
          SELECT 1
          FROM orders active_order
          WHERE active_order."riderId" IN (r.id, r."userId")
            AND active_order.status IN ('ACKNOWLEDGED', 'PICKED_UP', 'IN_TRANSIT')
            AND active_order."cancelledAt" IS NULL
            AND active_order."deliveredAt" IS NULL
            AND active_order."rejectedAt" IS NULL
        )
        AND ST_DWithin(
          ST_MakePoint($1, $2)::geography,
          ST_MakePoint(r."currentLongitude", r."currentLatitude")::geography,
          $3
        )
      ORDER BY distance
      LIMIT $4
    `;

    const riders = await this.riderRepository.query(query, [
      longitude,
      latitude,
      radiusInKm * 1000, // Convert to meters
      limit,
      maxLocationAgeMinutes,
    ]);

    return riders.map((rider) => ({
      riderId: rider.id,
      userId: rider.userId,
      name: `${rider.riderFirstName} ${rider.riderLastName}`,
      location: {
        latitude: parseFloat(rider.currentLatitude),
        longitude: parseFloat(rider.currentLongitude),
        lastUpdate: rider.lastLocationUpdate,
      },
      distance: Math.round(rider.distance),
      bikeType: rider.bikeType,
      bikeColor: rider.bikeColor,
      licensePlate: rider.licensePlate,
      rating: parseFloat(rider.rating),
      deliveries: parseInt(rider.totalDeliveries),
    }));
  }

  /**
   * Get rider statistics
   */
  async getRiderStats(riderId: string): Promise<any> {
    const rider = await this.findById(riderId);

    // Get document stats
    const documentStats = await this.documentRepository
      .createQueryBuilder('doc')
      .select('doc.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('doc.riderId = :riderId', { riderId })
      .groupBy('doc.status')
      .getRawMany();

    const documentsVerified =
      documentStats.find((d) => d.status === 'verified')?.count || 0;
    const documentsPending =
      documentStats.find((d) => d.status === 'pending')?.count || 0;
    const documentsRejected =
      documentStats.find((d) => d.status === 'rejected')?.count || 0;

    // Calculate profile completion
    const profileCompletion = this.calculateProfileCompletion(rider);

    return {
      riderId: rider.id,
      status: rider.status,
      stats: {
        rating: rider.rating,
        totalDeliveries: rider.totalDeliveries,
        totalEarnings: rider.totalEarnings,
        acceptanceRate: rider.acceptanceRate,
        completionRate: rider.completionRate,
        onlineHours: rider.onlineHours,
      },
      documents: {
        total: rider.documents?.length || 0,
        verified: Number(documentsVerified),
        pending: Number(documentsPending),
        rejected: Number(documentsRejected),
      },
      profileCompletion,
      online: {
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
      verification: {
        backgroundCheck: rider.backgroundCheckStatus,
        trainingCompleted: rider.trainingCompleted,
        bankDetailsVerified: rider.bankDetailsVerified,
      },
    };
  }

  /**
   * Update rider rating
   */
  async updateRating(riderId: string, newRating: number): Promise<void> {
    const rider = await this.findById(riderId);

    // Calculate new average rating
    const totalRatings = rider.totalDeliveries || 1;
    const currentTotal = rider.rating * totalRatings;
    const newTotal = currentTotal + newRating;
    const averageRating = newTotal / (totalRatings + 1);

    rider.rating = Math.round(averageRating * 10) / 10; // Round to 1 decimal
    await this.riderRepository.save(rider);
  }

  /**
   * Toggle rider online status
   */
  async toggleOnlineStatus(riderId: string, isOnline: boolean): Promise<Rider> {
    const rider = await this.findById(riderId);

    // Validate if rider can go online
    if (isOnline) {
      if (rider.status !== RiderStatus.ACTIVE) {
        throw new BadRequestException('Rider not active');
      }

      if (!rider.trainingCompleted) {
        throw new BadRequestException('Training not completed');
      }

      if (rider.backgroundCheckStatus !== 'approved') {
        throw new BadRequestException('Background check not approved');
      }
    }

    rider.isOnline = isOnline;
    if (!isOnline) {
      // Clear location when going offline
      rider.currentLatitude = null;
      rider.currentLongitude = null;
      rider.currentLocation = null;
    }

    return await this.riderRepository.save(rider);
  }

  /**
   * Verify rider document
   */
  async verifyDocument(
    documentId: string,
    status: DocumentStatus,
    notes?: string,
    verifiedBy?: string,
  ): Promise<RiderDocument> {
    const document = await this.documentRepository.findOne({
      where: { id: documentId },
      relations: ['rider'],
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    document.status = status;
    document.verificationNotes = notes;
    document.verifiedBy = verifiedBy;
    document.verifiedAt =
      status === DocumentStatus.VERIFIED ? new Date() : null;

    await this.documentRepository.save(document);

    // Check if all documents are verified
    if (status === DocumentStatus.VERIFIED) {
      await this.checkAllDocumentsVerified(document.riderId);
    }

    return document;
  }

  /**
   * Check if all required documents are verified
   */
  private async checkAllDocumentsVerified(riderId: string): Promise<void> {
    const documents = await this.documentRepository.find({
      where: { riderId },
    });

    const requiredDocs = [
      DocumentType.ID_CARD,
      DocumentType.DRIVING_LICENSE,
      DocumentType.BIKE_REGISTRATION,
    ];

    const allVerified = requiredDocs.every((docType) => {
      const doc = documents.find((d) => d.documentType === docType);
      return doc && doc.status === DocumentStatus.VERIFIED;
    });

    if (allVerified) {
      const rider = await this.findById(riderId);

      // Move to next stage if in document verification
      if (rider.status === RiderStatus.DOCUMENT_VERIFICATION) {
        rider.status = RiderStatus.BACKGROUND_CHECK;
        await this.riderRepository.save(rider);
      }
    }
  }

  /**
   * Get rider earnings report
   */
  async getEarningsReport(
    riderId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<any> {
    // This would join with deliveries/transactions table
    // Placeholder for now
    return {
      riderId,
      period: {
        start: startDate,
        end: endDate,
      },
      summary: {
        totalEarnings: 0,
        totalDeliveries: 0,
        averagePerDelivery: 0,
        tips: 0,
        bonuses: 0,
      },
      daily: [],
    };
  }

  /**
   * Calculate profile completion percentage
   */
  private calculateProfileCompletion(rider: Rider): {
    percentage: number;
    missingItems: string[];
  } {
    const requiredFields = [
      { field: 'bikeType', weight: 10, label: 'Bike Type' },
      { field: 'bikeBrand', weight: 5, label: 'Bike Brand' },
      { field: 'bikeModel', weight: 5, label: 'Bike Model' },
      { field: 'bikeColor', weight: 5, label: 'Bike Color' },
      { field: 'bikeYear', weight: 5, label: 'Bike Year' },
      { field: 'licensePlate', weight: 10, label: 'License Plate' },
      { field: 'hasHelmet', weight: 5, label: 'Helmet' },
      { field: 'hasPhoneMount', weight: 5, label: 'Phone Mount' },
      { field: 'hasDeliveryBag', weight: 5, label: 'Delivery Bag' },
      { field: 'licenseNumber', weight: 10, label: 'License Number' },
      { field: 'licenseClass', weight: 5, label: 'License Class' },
      { field: 'licenseExpiryDate', weight: 5, label: 'License Expiry' },
      { field: 'profilePhoto', weight: 5, label: 'Profile Photo' },
      { field: 'bankName', weight: 5, label: 'Bank Name' },
      { field: 'accountNumber', weight: 5, label: 'Account Number' },
      { field: 'accountHolderName', weight: 5, label: 'Account Holder' },
    ];

    const missingItems: string[] = [];
    let completedWeight = 0;
    let totalWeight = 0;

    requiredFields.forEach((item) => {
      totalWeight += item.weight;
      const value = rider[item.field as keyof Rider];

      if (value !== null && value !== undefined && value !== '') {
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

    const percentage = Math.round((completedWeight / totalWeight) * 100);

    return { percentage, missingItems };
  }

  /**
   * Clean up stale online status
   */
  async cleanupStaleOnlineStatus(minutes: number = 30): Promise<number> {
    const staleThreshold = new Date();
    staleThreshold.setMinutes(staleThreshold.getMinutes() - minutes);

    const result = await this.riderRepository
      .createQueryBuilder()
      .update(Rider)
      .set({
        isOnline: false,
        currentLatitude: null,
        currentLongitude: null,
        currentLocation: null,
        metadata: () =>
          "jsonb_set(metadata, '{offlineReason}', '\"location_timeout\"')",
      })
      .where('"isOnline" = true')
      .andWhere('"lastLocationUpdate" < :threshold', {
        threshold: staleThreshold,
      })
      .execute();

    return result.affected || 0;
  }

  /**
   * Get dashboard stats for admin
   */
  async getAdminDashboardStats(): Promise<any> {
    const totalRiders = await this.riderRepository.count();

    const activeRiders = await this.riderRepository.count({
      where: { status: RiderStatus.ACTIVE },
    });

    const onlineRiders = await this.riderRepository.count({
      where: { isOnline: true, status: RiderStatus.ACTIVE },
    });

    const pendingVerification = await this.riderRepository.count({
      where: {
        status: In([RiderStatus.PENDING, RiderStatus.DOCUMENT_VERIFICATION]),
      },
    });

    const inTraining = await this.riderRepository.count({
      where: { status: RiderStatus.TRAINING },
    });

    const suspended = await this.riderRepository.count({
      where: { status: RiderStatus.SUSPENDED },
    });

    // New riders this week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const newThisWeek = await this.riderRepository.count({
      where: { createdAt: MoreThan(oneWeekAgo) },
    });

    return {
      total: totalRiders,
      active: activeRiders,
      online: onlineRiders,
      pendingVerification,
      inTraining,
      suspended,
      newThisWeek,
      documentsPending: await this.getPendingDocumentsCount(),
    };
  }

  /**
   * Get count of pending documents
   */
  private async getPendingDocumentsCount(): Promise<number> {
    return await this.documentRepository.count({
      where: { status: DocumentStatus.PENDING },
    });
  }

  /**
   * Bulk update rider locations (for WebSocket)
   */
  async bulkUpdateLocations(
    locations: {
      riderId: string;
      latitude: number;
      longitude: number;
      timestamp?: Date;
    }[],
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (const loc of locations) {
        await queryRunner.manager.update(
          Rider,
          { id: loc.riderId, isOnline: true },
          {
            currentLatitude: loc.latitude,
            currentLongitude: loc.longitude,
            currentLocation: `POINT(${loc.longitude} ${loc.latitude})`,
            lastLocationUpdate: loc.timestamp || new Date(),
          },
        );
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Export riders data (for admin)
   */
  async exportRidersData(format: 'csv' | 'json' = 'json'): Promise<any> {
    const riders = await this.riderRepository.find({
      relations: ['user', 'documents'],
    });

    if (format === 'csv') {
      // Transform to CSV format
      const csvData = riders.map((rider) => ({
        id: rider.id,
        name: `${rider.user?.firstName} ${rider.user?.lastName}`,
        email: rider.user?.email,
        phone: rider.user?.mobile,
        status: rider.status,
        bikeType: rider.bikeType,
        licensePlate: rider.licensePlate,
        rating: rider.rating,
        totalDeliveries: rider.totalDeliveries,
        totalEarnings: rider.totalEarnings,
        isOnline: rider.isOnline,
        createdAt: rider.createdAt,
      }));
      return csvData;
    }

    return riders;
  }
}

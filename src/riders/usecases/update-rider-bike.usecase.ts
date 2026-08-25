import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BikeType, Rider } from '../model/rider.entity';
import {
  DocumentStatus,
  DocumentType,
  RiderDocument,
} from '../model/rider-document.entity';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { S3Service } from '../../utils/s3-bucket.service';
import { Users } from '../../users/model/users.entity';
import {
  deleteFilesBestEffort,
  hasValidSupportedImageSignature,
} from '../../utils/uploaded-file.util';
import { lockRiderDocumentMutation } from '../rider-document-lock';
import { reconcileRiderClearance } from '../rider-clearance';

export class UpdateBikeDto {
  @IsOptional()
  @IsEnum(BikeType)
  bikeType?: BikeType;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  bikeBrand?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  bikeModel?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  bikeColor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1980)
  @Max(new Date().getFullYear() + 1)
  bikeYear?: number;

  @IsOptional()
  @IsString()
  @Length(2, 30)
  licensePlate?: string;
}

interface VehicleDocuments {
  bikeRegistration?: Express.Multer.File;
  riderPermit?: Express.Multer.File;
}

@Injectable()
export class UpdateRiderBikeUseCase {
  private readonly logger = new Logger(UpdateRiderBikeUseCase.name);

  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    private readonly commonService: CommonService,
    private readonly s3Service: S3Service,
    private readonly dataSource: DataSource,
  ) {}

  async execute(
    dto: UpdateBikeDto,
    files: VehicleDocuments,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const rider = await this.riderRepository.findOne({
      where: { userId: authenticatedUser.id },
    });

    if (!rider) {
      throw new NotFoundException(
        new StandardResponse(true, 'RIDER_NOT_FOUND'),
      );
    }
    if (!files.bikeRegistration || !files.riderPermit) {
      throw new BadRequestException(
        new StandardResponse(
          true,
          'BIKE_REGISTRATION_AND_RIDER_PERMIT_REQUIRED',
        ),
      );
    }
    if (
      !hasValidSupportedImageSignature(files.bikeRegistration) ||
      !hasValidSupportedImageSignature(files.riderPermit)
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_VEHICLE_DOCUMENT_IMAGE'),
      );
    }

    const normalized = {
      bikeType: dto.bikeType,
      bikeBrand: dto.bikeBrand?.trim(),
      bikeModel: dto.bikeModel?.trim(),
      bikeColor: dto.bikeColor?.trim(),
      bikeYear: dto.bikeYear === undefined ? undefined : Number(dto.bikeYear),
      licensePlate: dto.licensePlate?.trim().toUpperCase(),
    };
    if (
      normalized.bikeYear !== undefined &&
      (!Number.isInteger(normalized.bikeYear) ||
        normalized.bikeYear < 1980 ||
        normalized.bikeYear > new Date().getFullYear() + 1)
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_BIKE_YEAR'),
      );
    }

    const pendingUploads = [
      {
        file: files.bikeRegistration,
        type: DocumentType.BIKE_REGISTRATION,
      },
      { file: files.riderPermit, type: DocumentType.DRIVING_LICENSE },
    ];
    const uploadResults = await Promise.allSettled(
      pendingUploads.map(async (entry) => {
        const [url] = await this.s3Service.uploadFiles([entry.file]);
        if (!url) throw new Error('Vehicle document upload returned no URL');
        return { ...entry, url };
      }),
    );
    const uploadedEntries = uploadResults
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<{
          file: Express.Multer.File;
          type: DocumentType;
          url: string;
        }> => result.status === 'fulfilled',
      )
      .map((result) => result.value);

    if (uploadedEntries.length !== pendingUploads.length) {
      await this.cleanupFiles(uploadedEntries.map((entry) => entry.url));
      const failure = uploadResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      throw failure?.reason || new Error('Vehicle document upload failed');
    }

    let replacedUrls: string[] = [];
    let riderStatus = rider.status;
    try {
      const transactionResult = await this.dataSource.transaction(
        async (manager) => {
          const user = await manager.findOne(Users, {
            where: { id: authenticatedUser.id },
            select: { id: true },
            lock: { mode: 'pessimistic_write' },
          });
          if (!user) {
            throw new NotFoundException(
              new StandardResponse(true, 'USER_NOT_FOUND'),
            );
          }
          await lockRiderDocumentMutation(manager, rider.id);
          const lockedRider = await manager.findOne(Rider, {
            where: { id: rider.id, userId: authenticatedUser.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!lockedRider) {
            throw new NotFoundException(
              new StandardResponse(true, 'RIDER_NOT_FOUND'),
            );
          }
          const types = [
            DocumentType.BIKE_REGISTRATION,
            DocumentType.DRIVING_LICENSE,
          ];
          const replaced = await manager.find(RiderDocument, {
            where: { riderId: rider.id, documentType: In(types) },
            select: { documentUrl: true },
          });
          await manager.delete(RiderDocument, {
            riderId: rider.id,
            documentType: In(types),
          });
          await manager.save(
            RiderDocument,
            uploadedEntries.map((entry) =>
              manager.create(RiderDocument, {
                riderId: rider.id,
                documentType: entry.type,
                documentUrl: entry.url,
                status: DocumentStatus.PENDING,
              }),
            ),
          );

          const bikeChanges = Object.fromEntries(
            Object.entries(normalized).filter(
              ([, value]) => value !== undefined,
            ),
          );
          Object.assign(lockedRider, bikeChanges);
          const currentDocuments = await manager.find(RiderDocument, {
            where: { riderId: lockedRider.id },
          });
          reconcileRiderClearance(lockedRider, currentDocuments);
          await manager.save(Rider, lockedRider);
          return {
            riderStatus: lockedRider.status,
            replacedUrls: replaced
              .map((document) => document.documentUrl)
              .filter((url): url is string => Boolean(url)),
          };
        },
      );
      replacedUrls = transactionResult.replacedUrls;
      riderStatus = transactionResult.riderStatus;
    } catch (error) {
      await this.cleanupFiles(uploadedEntries.map((entry) => entry.url));
      throw error;
    }

    await this.cleanupFiles(replacedUrls);

    return new StandardResponse(false, 'RIDER_BIKE_DETAILS_UPDATED', {
      ...normalized,
      documentStatus: DocumentStatus.PENDING,
      riderStatus,
    });
  }

  private async cleanupFiles(urls: string[]): Promise<void> {
    const pending = await deleteFilesBestEffort(this.s3Service, urls);
    if (pending.length > 0) {
      this.logger.error(
        `Unable to delete ${pending.length} superseded rider document(s) from S3`,
      );
    }
  }
}

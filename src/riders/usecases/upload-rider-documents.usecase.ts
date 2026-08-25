import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { BikeType, Rider, RiderStatus } from '../model/rider.entity';
import {
  RiderDocument,
  DocumentType,
  DocumentStatus,
} from '../model/rider-document.entity';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { S3Service } from '../../utils/s3-bucket.service';
import { UserLocations } from '../../users/model/user-locations.entity';
import { Users } from '../../users/model/users.entity';
import {
  deleteFilesBestEffort,
  hasValidSupportedImageSignature,
} from '../../utils/uploaded-file.util';
import { lockRiderDocumentMutation } from '../rider-document-lock';

interface UploadRiderDocumentsProps {
  ninSlip?: Express.Multer.File;
  permitFront?: Express.Multer.File;
  permitBack?: Express.Multer.File;
  bikeRegistration?: Express.Multer.File;
  onboardingVersion?: '2';
  bikeType?: string;
  bikeBrand?: string;
  bikeModel?: string;
  bikeColor?: string;
  licensePlate?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  country?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
}

@Injectable()
export class UploadRiderDocumentsUseCase {
  private readonly logger = new Logger(UploadRiderDocumentsUseCase.name);

  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,

    private readonly commonService: CommonService,
    private readonly s3Service: S3Service,
    private readonly dataSource: DataSource,
  ) {}

  async execute(props: UploadRiderDocumentsProps): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();

    const rider = await this.riderRepository.findOne({
      where: { userId: authenticatedUser.id },
    });

    if (!rider) {
      throw new NotFoundException(
        new StandardResponse(true, 'RIDER_NOT_FOUND'),
      );
    }
    if (!props.ninSlip || !props.permitFront || !props.permitBack) {
      throw new BadRequestException(
        'NIN slip and both sides of the rider permit are required',
      );
    }
    if (
      props.onboardingVersion === '2' &&
      (!props.bikeRegistration ||
        !props.bikeType?.trim() ||
        !props.bikeBrand?.trim() ||
        !props.bikeModel?.trim() ||
        !props.bikeColor?.trim() ||
        !props.licensePlate?.trim() ||
        !props.streetAddress?.trim() ||
        !props.city?.trim() ||
        !props.state?.trim() ||
        !props.country?.trim())
    ) {
      throw new BadRequestException(
        'Complete vehicle details, bike registration, and residential address are required',
      );
    }
    if (
      ![props.ninSlip, props.permitFront, props.permitBack]
        .concat(props.bikeRegistration ? [props.bikeRegistration] : [])
        .every(hasValidSupportedImageSignature)
    ) {
      throw new BadRequestException(
        'One or more uploaded documents is not a valid image',
      );
    }
    if (
      ![
        RiderStatus.PENDING,
        RiderStatus.REJECTED,
        RiderStatus.DOCUMENT_VERIFICATION,
      ].includes(rider.status)
    ) {
      throw new BadRequestException(
        `Documents cannot be replaced while rider status is ${rider.status}`,
      );
    }

    const uploads: Array<{
      file: Express.Multer.File;
      type: DocumentType;
      url?: string;
    }> = [
      { file: props.ninSlip, type: DocumentType.ID_CARD },
      { file: props.permitFront, type: DocumentType.DRIVING_LICENSE },
      { file: props.permitBack, type: DocumentType.DRIVING_LICENSE },
    ];
    if (props.bikeRegistration) {
      uploads.push({
        file: props.bikeRegistration,
        type: DocumentType.BIKE_REGISTRATION,
      });
    }
    const uploadedUrls: string[] = [];
    let uploadedDocs: RiderDocument[] = [];
    let replacedDocumentUrls: string[] = [];
    try {
      const uploadResults = await Promise.allSettled(
        uploads.map(async (upload) => {
          const [url] = await this.s3Service.uploadFiles([upload.file]);
          if (!url) throw new Error('Document upload returned no URL');
          upload.url = url;
          return url;
        }),
      );
      uploadedUrls.push(
        ...uploadResults
          .filter(
            (result): result is PromiseFulfilledResult<string> =>
              result.status === 'fulfilled',
          )
          .map((result) => result.value),
      );
      const failedUpload = uploadResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (failedUpload) {
        throw failedUpload.reason;
      }

      const transactionResult = await this.dataSource.transaction(
        async (manager) => {
          const user = await manager.findOne(Users, {
            where: { id: authenticatedUser.id },
            select: { id: true, locationId: true },
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
          if (
            ![
              RiderStatus.PENDING,
              RiderStatus.REJECTED,
              RiderStatus.DOCUMENT_VERIFICATION,
            ].includes(lockedRider.status)
          ) {
            throw new BadRequestException(
              `Documents cannot be replaced while rider status is ${lockedRider.status}`,
            );
          }
          const typesToReplace = [
            ...new Set(uploads.map((upload) => upload.type)),
          ];
          const replacedDocuments = await manager.find(RiderDocument, {
            where: {
              riderId: rider.id,
              documentType: In(typesToReplace),
            },
            select: { documentUrl: true },
          });
          await manager.delete(RiderDocument, {
            riderId: rider.id,
            documentType: In(typesToReplace),
          });
          const documents = uploads.map((upload) =>
            manager.create(RiderDocument, {
              riderId: rider.id,
              documentType: upload.type,
              documentUrl: upload.url,
              status: DocumentStatus.PENDING,
            }),
          );
          const saved = await manager.save(RiderDocument, documents);
          lockedRider.status = RiderStatus.DOCUMENT_VERIFICATION;
          lockedRider.isOnline = false;

          const bikeType = String(props.bikeType || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '_');
          if (Object.values(BikeType).includes(bikeType as BikeType)) {
            lockedRider.bikeType = bikeType as BikeType;
          }
          lockedRider.licensePlate =
            props.licensePlate?.trim().toUpperCase().slice(0, 30) ||
            lockedRider.licensePlate;
          lockedRider.bikeBrand =
            props.bikeBrand?.trim().slice(0, 80) || lockedRider.bikeBrand;
          lockedRider.bikeModel =
            props.bikeModel?.trim().slice(0, 80) || lockedRider.bikeModel;
          lockedRider.bikeColor =
            props.bikeColor?.trim().slice(0, 40) || lockedRider.bikeColor;
          lockedRider.emergencyContactName =
            props.emergencyContactName?.trim().slice(0, 100) ||
            lockedRider.emergencyContactName;
          lockedRider.emergencyContactPhone =
            props.emergencyContactPhone?.trim().slice(0, 30) ||
            lockedRider.emergencyContactPhone;
          lockedRider.emergencyContactRelation =
            props.emergencyContactRelationship?.trim().slice(0, 50) ||
            lockedRider.emergencyContactRelation;
          await manager.save(Rider, lockedRider);

          if (
            props.streetAddress?.trim() &&
            props.city?.trim() &&
            props.state?.trim() &&
            props.country?.trim()
          ) {
            const locationValues = {
              address: props.streetAddress.trim().slice(0, 200),
              city: props.city.trim().toLowerCase().slice(0, 100),
              state: props.state.trim().slice(0, 100),
              country: props.country.trim().slice(0, 100),
            };
            let location = user.locationId
              ? await manager.findOne(UserLocations, {
                  where: { id: user.locationId },
                })
              : null;
            if (location?.addedBy === authenticatedUser.id) {
              Object.assign(location, locationValues);
            } else {
              location = manager.create(UserLocations, {
                ...locationValues,
                addedBy: authenticatedUser.id,
                isSupported: true,
              });
            }
            location = await manager.save(UserLocations, location);
            if (user.locationId !== location.id) {
              await manager.update(
                Users,
                { id: authenticatedUser.id },
                { locationId: location.id },
              );
            }
          }
          return {
            saved,
            rider: lockedRider,
            replacedDocumentUrls: replacedDocuments
              .map((document) => document.documentUrl)
              .filter(Boolean),
          };
        },
      );
      uploadedDocs = transactionResult.saved;
      Object.assign(rider, transactionResult.rider);
      replacedDocumentUrls = transactionResult.replacedDocumentUrls;
    } catch (error) {
      const cleanupFailures = await deleteFilesBestEffort(
        this.s3Service,
        uploadedUrls,
      );
      if (cleanupFailures.length > 0) {
        this.logger.error(
          `Unable to roll back ${cleanupFailures.length} newly uploaded rider document(s)`,
        );
      }
      throw error;
    }

    const cleanupFailures = await deleteFilesBestEffort(
      this.s3Service,
      replacedDocumentUrls,
    );
    if (cleanupFailures.length > 0) {
      this.logger.error(
        `Unable to delete ${cleanupFailures.length} superseded rider document(s)`,
      );
    }

    return new StandardResponse(
      false,
      'RIDER_DOCUMENTS_UPLOADED_SUCCESSFULLY',
      {
        uploadedDocuments: uploadedDocs.map((d) => ({
          id: d.id,
          type: d.documentType,
          status: d.status,
        })),
        riderStatus: RiderStatus.DOCUMENT_VERIFICATION,
      },
    );
  }
}

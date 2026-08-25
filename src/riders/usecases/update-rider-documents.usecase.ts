import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Rider } from '../model/rider.entity';
import {
  RiderDocument,
  DocumentType,
  DocumentStatus,
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

interface UpdateRiderDocumentsProps {
  ninSlip?: Express.Multer.File;
  permitFront?: Express.Multer.File;
  permitBack?: Express.Multer.File;
  bikeRegistration?: Express.Multer.File;
  correctionOnly?: boolean;
}

@Injectable()
export class UpdateRiderDocumentsUseCase {
  private readonly logger = new Logger(UpdateRiderDocumentsUseCase.name);

  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,

    private readonly commonService: CommonService,
    private readonly s3Service: S3Service,
    private readonly dataSource: DataSource,
  ) {}

  async execute(props: UpdateRiderDocumentsProps): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();

    const rider = await this.riderRepository.findOne({
      where: { userId: authenticatedUser.id },
    });

    if (!rider) {
      throw new NotFoundException(
        new StandardResponse(true, 'RIDER_NOT_FOUND'),
      );
    }

    // At least one document must be provided
    const candidates = [
      props.ninSlip
        ? { file: props.ninSlip, type: DocumentType.ID_CARD }
        : null,
      props.permitFront
        ? { file: props.permitFront, type: DocumentType.DRIVING_LICENSE }
        : null,
      props.permitBack
        ? { file: props.permitBack, type: DocumentType.DRIVING_LICENSE }
        : null,
      props.bikeRegistration
        ? { file: props.bikeRegistration, type: DocumentType.BIKE_REGISTRATION }
        : null,
    ].filter(
      (c): c is { file: Express.Multer.File; type: DocumentType } => c !== null,
    );

    if (candidates.length === 0) {
      throw new BadRequestException('At least one document must be provided');
    }
    if (Boolean(props.permitFront) !== Boolean(props.permitBack)) {
      throw new BadRequestException(
        'Both sides of the rider permit must be uploaded together',
      );
    }

    // Validate image signatures before touching S3
    if (
      !candidates.every(({ file }) => hasValidSupportedImageSignature(file))
    ) {
      throw new BadRequestException(
        'One or more uploaded documents is not a valid image',
      );
    }

    // Upload to S3 first (outside transaction so we can roll back on DB failure)
    type UploadEntry = {
      file: Express.Multer.File;
      type: DocumentType;
      url: string;
    };
    const uploadedEntries: UploadEntry[] = [];

    const uploadResults = await Promise.allSettled(
      candidates.map(async (candidate) => {
        const [url] = await this.s3Service.uploadFiles([candidate.file]);
        if (!url) throw new Error('Document upload returned no URL');
        return { ...candidate, url };
      }),
    );
    uploadedEntries.push(
      ...uploadResults
        .filter(
          (result): result is PromiseFulfilledResult<UploadEntry> =>
            result.status === 'fulfilled',
        )
        .map((result) => result.value),
    );
    const failedUpload = uploadResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failedUpload) {
      await this.cleanupFiles(
        uploadedEntries.map((entry) => entry.url),
        'newly uploaded',
      );
      throw failedUpload.reason;
    }

    const typesToReplace = [...new Set(uploadedEntries.map((e) => e.type))];
    let uploadedDocs: RiderDocument[] = [];
    let replacedDocumentUrls: string[] = [];

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

          const replacedDocuments = await manager.find(RiderDocument, {
            where: { riderId: rider.id, documentType: In(typesToReplace) },
            select: ['documentUrl', 'documentType', 'status'],
          });

          if (
            props.correctionOnly &&
            !typesToReplace.every((type) =>
              replacedDocuments.some(
                (document) =>
                  document.documentType === type &&
                  document.status === DocumentStatus.REJECTED,
              ),
            )
          ) {
            throw new ConflictException(
              'One or more documents no longer require replacement',
            );
          }

          await manager.delete(RiderDocument, {
            riderId: rider.id,
            documentType: In(typesToReplace),
          });

          const newDocs = uploadedEntries.map((e) =>
            manager.create(RiderDocument, {
              riderId: rider.id,
              documentType: e.type,
              documentUrl: e.url,
              status: DocumentStatus.PENDING,
            }),
          );

          const saved = await manager.save(RiderDocument, newDocs);
          const currentDocuments = await manager.find(RiderDocument, {
            where: { riderId: lockedRider.id },
          });
          reconcileRiderClearance(lockedRider, currentDocuments);
          await manager.save(Rider, lockedRider);

          return {
            saved,
            riderStatus: lockedRider.status,
            replacedDocumentUrls: replacedDocuments
              .map((doc) => doc.documentUrl)
              .filter((u): u is string => Boolean(u)),
          };
        },
      );

      uploadedDocs = transactionResult.saved;
      replacedDocumentUrls = transactionResult.replacedDocumentUrls;
      rider.status = transactionResult.riderStatus;
    } catch (error) {
      // DB failed — roll back S3 uploads
      await this.cleanupFiles(
        uploadedEntries.map((entry) => entry.url),
        'newly uploaded',
      );
      throw error;
    }

    await this.cleanupFiles(replacedDocumentUrls, 'superseded');

    return new StandardResponse(false, 'RIDER_DOCUMENTS_UPDATED_SUCCESSFULLY', {
      updatedDocuments: uploadedDocs.map((d) => ({
        id: d.id,
        type: d.documentType,
        status: d.status,
      })),
      riderStatus: rider.status,
    });
  }

  private async cleanupFiles(urls: string[], label: string): Promise<void> {
    const failures = await deleteFilesBestEffort(this.s3Service, urls);
    if (failures.length > 0) {
      this.logger.error(
        `Unable to delete ${failures.length} ${label} rider document(s)`,
      );
    }
  }
}

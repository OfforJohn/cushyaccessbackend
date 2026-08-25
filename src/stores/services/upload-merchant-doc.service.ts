import { BadRequestException, Injectable } from '@nestjs/common';
import { S3Service } from 'src/utils/s3-bucket.service';
import { StandardResponse } from 'src/common/module/standard-response';

interface UploadMerchantDocumentsProps {
  businessRegistration?: Express.Multer.File;
  governmentId?: Express.Multer.File;
  proofOfAddress?: Express.Multer.File;
  pharmacyLicense?: Express.Multer.File;
}

@Injectable()
export class UploadMerchantDocumentsService {
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  constructor(private readonly s3Service: S3Service) {}

  private validateFileSize(file?: Express.Multer.File) {
    if (file && file.size > this.MAX_FILE_SIZE) {
      throw new BadRequestException(
        new StandardResponse(
          true,
          `${file.originalname} exceeds maximum allowed size of 5MB.`,
        ),
      );
    }
  }

  async execute(props: UploadMerchantDocumentsProps) {
    const { businessRegistration, governmentId, proofOfAddress, pharmacyLicense } = props;

    this.validateFileSize(businessRegistration);
    this.validateFileSize(governmentId);
    this.validateFileSize(proofOfAddress);
    this.validateFileSize(pharmacyLicense);
    let uploadedBusinessRegistration: string | undefined;
    let uploadedGovernmentId: string | undefined;
    let uploadedProofOfAddress: string | undefined;
    let uploadedPharmacyLicense: string | undefined;

    if (pharmacyLicense) {
      uploadedPharmacyLicense = await this.s3Service.uploadMerchantDocuments(
        pharmacyLicense,
      );
    }

    if (businessRegistration) {
      uploadedBusinessRegistration = await this.s3Service.uploadMerchantDocuments(
        businessRegistration,
      );
    }

    if (governmentId) {
      uploadedGovernmentId = await this.s3Service.uploadMerchantDocuments(
        governmentId,
      );
    }

    if (proofOfAddress) {
      uploadedProofOfAddress =
        await this.s3Service.uploadMerchantDocuments(
          proofOfAddress,
        );
    }

    return new StandardResponse(
      false,
      'MERCHANT_DOCUMENTS_UPLOADED_SUCCESSFULLY',
      {
        businessRegistration: uploadedBusinessRegistration,
        governmentId: uploadedGovernmentId,
        proofOfAddress: uploadedProofOfAddress,
        pharmacyLicense: uploadedPharmacyLicense,
      },
    );
  }
}

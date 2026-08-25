import { BadRequestException, Injectable } from '@nestjs/common';
import { S3Service } from 'src/utils/s3-bucket.service';
import { StandardResponse } from 'src/common/module/standard-response';

interface UploadDoctorDocumentsProps {
  medicalLicense?: Express.Multer.File;
  governmentId?: Express.Multer.File;
  professionalCertificate?: Express.Multer.File;
}

@Injectable()
export class UploadDoctorDocumentsUseCase {
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  constructor(private readonly s3Service: S3Service) {}

  private validateFileSize(file?: Express.Multer.File) {
    if (file && file.size > this.MAX_FILE_SIZE) {
      throw new BadRequestException(
        `${file.originalname} exceeds maximum allowed size of 5MB.`,
      );
    }
  }

  async execute(props: UploadDoctorDocumentsProps) {
    const { medicalLicense, governmentId, professionalCertificate } = props;

    this.validateFileSize(medicalLicense);
    this.validateFileSize(governmentId);
    this.validateFileSize(professionalCertificate);

    let uploadedMedicalLicense: string | undefined;
    let uploadedGovernmentId: string | undefined;
    let uploadedProfessionalCertificate: string | undefined;

    if (medicalLicense) {
      uploadedMedicalLicense =
        await this.s3Service.uploadMedicalLicense(medicalLicense);
    }

    if (governmentId) {
      uploadedGovernmentId =
        await this.s3Service.uploadMedicalLicense(governmentId);
    }

    if (professionalCertificate) {
      uploadedProfessionalCertificate =
        await this.s3Service.uploadMedicalLicense(professionalCertificate);
    }

    return new StandardResponse(
      false,
      'DOCTOR_DOCUMENTS_UPLOADED_SUCCESSFULLY',
      {
        medicalLicense: uploadedMedicalLicense,
        governmentId: uploadedGovernmentId,
        professionalCertificate: uploadedProfessionalCertificate,
      },
    );
  }
}

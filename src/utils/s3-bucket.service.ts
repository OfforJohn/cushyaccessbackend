import { BadRequestException, Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { StandardResponse } from 'src/common/module/standard-response';
import { randomUUID } from 'crypto';

interface UploadDoctorProfileOptions {
  doctorId?: string;
  fileName?: string;
  isPublic?: boolean;
}

@Injectable()
export class S3Service {
  private s3Client: S3Client;
  private bucketName: string;

  constructor() {
    this.bucketName = process.env.S3_BUCKET_NAME;
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  async uploadFiles(files: Express.Multer.File[]): Promise<string[]> {
    const uploadPromises = files.map(async (file) => {
      const sanitizedFilename =
        file.originalname
          .replace(/[^A-Za-z0-9._-]/g, '_')
          .replace(/_+/g, '_')
          .slice(-120) || 'upload';
      const key = `Cushy-Access-Storage/${randomUUID()}_${sanitizedFilename}`;
      const params = {
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      };

      try {
        await this.s3Client.send(new PutObjectCommand(params));
        // Construct the public URL
        return `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
      } catch (error) {
        throw new Error(
          `Failed to upload ${file.originalname}: ${error.message}`,
        );
      }
    });

    return Promise.all(uploadPromises); // Returns array of file URLs
  }

  async getPassport() {
    try {
      const params = {
        Bucket: this.bucketName,
        Prefix: 'Cushy-Access-Storage/', // List objects in the folder
      };
      const result = await this.s3Client.send(new ListObjectsV2Command(params));
      const objects =
        result.Contents?.map((obj) => ({
          key: obj.Key,
          url: `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${obj.Key}`,
        })) || [];
      console.log(objects);
      return objects;
    } catch (error) {
      throw new BadRequestException(
        new StandardResponse(true, 'FAILED_TO_LIST_FILES', error.message),
      );
    }
  }

  async deleteFile(key: string) {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key,
      };
      const result = await this.s3Client.send(new DeleteObjectCommand(params));
      if (result.$metadata.httpStatusCode === 204) {
        return new StandardResponse(false, 'FILE_DELETED_SUCCESSFULLY');
      } else {
        throw new Error('File deletion failed');
      }
    } catch (error) {
      throw new BadRequestException(
        new StandardResponse(true, 'FILE_DELETION_FAILED', error.message),
      );
    }
  }

  async deleteFileByUrl(url: string) {
    const prefix = `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
    if (!url?.startsWith(prefix)) {
      throw new BadRequestException(
        new StandardResponse(true, 'FILE_DELETION_FAILED', {
          reason: 'Invalid S3 URL',
        }),
      );
    }
    return this.deleteFile(url.slice(prefix.length));
  }
  async uploadAdsFiles(
    files: Express.Multer.File[] | undefined,
  ): Promise<string[]> {
    if (!files?.length) {
      throw new BadRequestException(
        new StandardResponse(true, 'ADVERTISEMENT_IMAGE_REQUIRED'),
      );
    }

    const uploadPromises = files.map(async (file) => {
      const key = `Cushy-Access-Ads/${Date.now()}_${file.originalname}`;

      const params = {
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer, // buffer is enough
        ContentType: file.mimetype,
      };

      await this.s3Client.send(new PutObjectCommand(params));

      return `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    });

    return Promise.all(uploadPromises);
  }
  async uploadDoctorSignature(files: Express.Multer.File[]): Promise<string[]> {
    const uploadPromises = files.map(async (file) => {
      const key = `Cushy-Access-Doctor-Signature/${Date.now()}_${file.originalname}`;

      const params = {
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer, // buffer is enough
        ContentType: file.mimetype,
      };

      await this.s3Client.send(new PutObjectCommand(params));

      return `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    });

    return Promise.all(uploadPromises);
  }

  async uploadMedicalLicense(file: Express.Multer.File) {
    const key = `medical_license/${Date.now()}_${file.originalname}`;

    try {
      const params = {
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      };
      await this.s3Client.send(new PutObjectCommand(params));

      return `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    } catch (err) {
      throw new Error(`File upload failed: ${err.message}`);
    }
  }
  async uploadDoctorProfileWithMetadata(
    file: Express.Multer.File,
    options: UploadDoctorProfileOptions = {},
  ): Promise<{ url: string; key: string }> {
    const { doctorId, fileName } = options;

    // Generate a cleaner filename
    const originalName = fileName || file.originalname;
    const sanitizedFileName = originalName.replace(/\s+/g, '_').toLowerCase();

    // Create key with optional doctor ID for better organization
    const key = doctorId
      ? `doctor-profiles/${doctorId}/${Date.now()}_${sanitizedFileName}`
      : `doctor-profiles/${Date.now()}_${sanitizedFileName}`;

    try {
      const params: any = {
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: {
          uploadedAt: new Date().toISOString(),
          doctorId: doctorId || 'unknown',
          originalFilename: file.originalname,
        },
      };

      await this.s3Client.send(new PutObjectCommand(params));

      return {
        url: `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
        key: key,
      };
    } catch (error) {
      throw new Error(
        `Failed to upload doctor profile picture: ${error.message}`,
      );
    }
  }
  async getDoctorProfilePictures(): Promise<
    Array<{ key: string; url: string }>
  > {
    try {
      const params = {
        Bucket: this.bucketName,
        Prefix: 'doctor-profiles/',
      };

      const result = await this.s3Client.send(new ListObjectsV2Command(params));

      return (
        result.Contents?.map((obj) => ({
          key: obj.Key,
          url: `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${obj.Key}`,
        })) || []
      );
    } catch (error) {
      throw new BadRequestException(
        new StandardResponse(
          true,
          'FAILED_TO_LIST_DOCTOR_PROFILES',
          error.message,
        ),
      );
    }
  }

  async deleteDoctorProfilePicture(key: string): Promise<StandardResponse> {
    try {
      // Ensure the key belongs to doctor-profiles folder
      if (!key.startsWith('doctor-profiles/')) {
        throw new Error('Invalid key: Not a doctor profile picture');
      }

      const params = {
        Bucket: this.bucketName,
        Key: key,
      };

      const result = await this.s3Client.send(new DeleteObjectCommand(params));

      if (result.$metadata.httpStatusCode === 204) {
        return new StandardResponse(
          false,
          'DOCTOR_PROFILE_DELETED_SUCCESSFULLY',
        );
      } else {
        throw new Error('Doctor profile deletion failed');
      }
    } catch (error) {
      throw new BadRequestException(
        new StandardResponse(
          true,
          'DOCTOR_PROFILE_DELETION_FAILED',
          error.message,
        ),
      );
    }
  }
  async uploadMerchantDocuments(file: Express.Multer.File) {
    const key = `merchant_documents/${Date.now()}_${file.originalname}`;

    try {
      const params = {
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      };
      await this.s3Client.send(new PutObjectCommand(params));

      return `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    } catch (err) {
      throw new Error(`File upload failed: ${err.message}`);
    }
  }
  async uploadProductImages(files: Express.Multer.File[]): Promise<string[]> {
    const uploadPromises = files.map(async (file) => {
      const key = `product_images/${Date.now()}_${file.originalname}`; // Unique key with folder
      const params = {
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      };

      try {
        await this.s3Client.send(new PutObjectCommand(params));
        // Construct the public URL
        return `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
      } catch (error) {
        throw new Error(
          `Failed to upload ${file.originalname}: ${error.message}`,
        );
      }
    });

    return Promise.all(uploadPromises); // Returns array of file URLs
  }
}

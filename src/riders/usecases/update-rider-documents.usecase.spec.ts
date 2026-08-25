import { BadRequestException } from '@nestjs/common';
import { Users } from '../../users/model/users.entity';
import { Rider, RiderStatus } from '../model/rider.entity';
import {
  DocumentStatus,
  DocumentType,
  RiderDocument,
} from '../model/rider-document.entity';
import { UpdateRiderDocumentsUseCase } from './update-rider-documents.usecase';

const image = (name: string) =>
  ({
    originalname: name,
    mimetype: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  }) as Express.Multer.File;

describe('UpdateRiderDocumentsUseCase', () => {
  const createContext = () => {
    const rider = {
      id: 'rider_1',
      userId: 'user_1',
      status: RiderStatus.ACTIVE,
      isOnline: true,
      backgroundCheckStatus: 'approved',
      trainingCompleted: true,
    } as Rider;
    const existingDocuments = [
      {
        documentType: DocumentType.ID_CARD,
        documentUrl: 'https://old/nin',
        status: DocumentStatus.VERIFIED,
      },
      {
        documentType: DocumentType.DRIVING_LICENSE,
        documentUrl: 'https://old/permit-front',
        status: DocumentStatus.VERIFIED,
      },
      {
        documentType: DocumentType.DRIVING_LICENSE,
        documentUrl: 'https://old/permit-back',
        status: DocumentStatus.VERIFIED,
      },
      {
        documentType: DocumentType.BIKE_REGISTRATION,
        documentUrl: 'https://old/registration',
        status: DocumentStatus.VERIFIED,
      },
    ] as RiderDocument[];
    let savedDocuments: RiderDocument[] = [];
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === Users) return { id: 'user_1' };
        if (entity === Rider) return rider;
        return null;
      }),
      find: jest.fn(async (_entity: unknown, options: any) => {
        const requestedTypes = options.where.documentType?._value;
        if (requestedTypes) {
          return existingDocuments.filter((document) =>
            requestedTypes.includes(document.documentType),
          );
        }
        const replacedTypes = new Set(
          savedDocuments.map((document) => document.documentType),
        );
        return [
          ...existingDocuments.filter(
            (document) => !replacedTypes.has(document.documentType),
          ),
          ...savedDocuments,
        ];
      }),
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((_entity: unknown, value: object) => value),
      save: jest.fn(async (entity: unknown, value: any) => {
        if (entity === RiderDocument) {
          savedDocuments = value.map(
            (document: RiderDocument, index: number) => ({
              ...document,
              id: `new_${index}`,
            }),
          );
          return savedDocuments;
        }
        return value;
      }),
    };
    const s3Service = {
      uploadFiles: jest.fn(async ([file]: Express.Multer.File[]) => [
        `https://new/${file.originalname}`,
      ]),
      deleteFileByUrl: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      transaction: jest.fn((callback: (value: typeof manager) => unknown) =>
        callback(manager),
      ),
    };
    const useCase = new UpdateRiderDocumentsUseCase(
      { findOne: jest.fn().mockResolvedValue(rider) } as never,
      {
        getLoggedInUser: jest.fn().mockResolvedValue({ id: 'user_1' }),
      } as never,
      s3Service as never,
      dataSource as never,
    );
    return { useCase, rider, manager, s3Service, dataSource };
  };

  it('requires both permit sides and does not upload a partial replacement', async () => {
    const context = createContext();

    await expect(
      context.useCase.execute({ permitFront: image('front.jpg') }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(context.s3Service.uploadFiles).not.toHaveBeenCalled();
    expect(context.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('atomically replaces both permit sides and suspends active availability pending review', async () => {
    const context = createContext();

    const response = await context.useCase.execute({
      permitFront: image('front.jpg'),
      permitBack: image('back.jpg'),
    });

    expect(context.manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['rider-documents:rider_1'],
    );
    expect(context.rider.status).toBe(RiderStatus.DOCUMENT_VERIFICATION);
    expect(context.rider.isOnline).toBe(false);
    expect((response.toJSON().data as any).updatedDocuments).toHaveLength(2);
    expect(context.s3Service.deleteFileByUrl).toHaveBeenCalledWith(
      'https://old/permit-front',
    );
    expect(context.s3Service.deleteFileByUrl).toHaveBeenCalledWith(
      'https://old/permit-back',
    );
    expect(context.s3Service.deleteFileByUrl).not.toHaveBeenCalledWith(
      'https://old/nin',
    );
  });

  it('removes newly uploaded files if the database transaction fails', async () => {
    const context = createContext();
    (context.dataSource.transaction as jest.Mock).mockRejectedValueOnce(
      new Error('DB failed'),
    );

    await expect(
      context.useCase.execute({ ninSlip: image('nin.jpg') }),
    ).rejects.toThrow('DB failed');

    expect(context.s3Service.deleteFileByUrl).toHaveBeenCalledWith(
      'https://new/nin.jpg',
    );
  });

  it('replaces a rejected bike registration by itself', async () => {
    const context = createContext();

    const response = await context.useCase.execute({
      bikeRegistration: image('registration.jpg'),
    });

    expect((response.toJSON().data as any).updatedDocuments).toEqual([
      expect.objectContaining({ type: DocumentType.BIKE_REGISTRATION }),
    ]);
    expect(context.s3Service.deleteFileByUrl).toHaveBeenCalledWith(
      'https://old/registration',
    );
  });

  it('rejects a stale correction after the document was already approved', async () => {
    const context = createContext();

    await expect(
      context.useCase.execute({
        ninSlip: image('nin.jpg'),
        correctionOnly: true,
      }),
    ).rejects.toThrow('One or more documents no longer require replacement');

    expect(context.s3Service.deleteFileByUrl).toHaveBeenCalledWith(
      'https://new/nin.jpg',
    );
  });
});

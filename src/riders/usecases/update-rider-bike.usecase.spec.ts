/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
import { Rider, RiderStatus } from '../model/rider.entity';
import { RiderDocument } from '../model/rider-document.entity';
import { Users } from '../../users/model/users.entity';
import { UpdateRiderBikeUseCase } from './update-rider-bike.usecase';

const image = (name: string) =>
  ({
    originalname: name,
    mimetype: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  }) as Express.Multer.File;

describe('UpdateRiderBikeUseCase', () => {
  const rider = {
    id: 'rider-1',
    userId: 'user-1',
    status: RiderStatus.ACTIVE,
    isOnline: true,
    trainingCompleted: true,
    backgroundCheckStatus: 'approved',
  } as Rider;

  it('requires both replacement documents before uploading anything', async () => {
    const s3Service = { uploadFiles: jest.fn() };
    const useCase = new UpdateRiderBikeUseCase(
      { findOne: jest.fn().mockResolvedValue(rider) } as never,
      {
        getLoggedInUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
      } as never,
      s3Service as never,
      {} as never,
    );

    await expect(
      useCase.execute(
        { bikeBrand: 'Bajaj' },
        { bikeRegistration: image('bike.jpg') },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(s3Service.uploadFiles).not.toHaveBeenCalled();
  });

  it('commits fields and documents together, then removes superseded S3 files', async () => {
    const s3Service = {
      uploadFiles: jest
        .fn()
        .mockResolvedValueOnce(['https://new/registration'])
        .mockResolvedValueOnce(['https://new/permit']),
      deleteFileByUrl: jest.fn().mockResolvedValue(undefined),
    };
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      find: jest
        .fn()
        .mockResolvedValueOnce([
          { documentUrl: 'https://old/registration' },
          { documentUrl: 'https://old/permit' },
        ])
        .mockResolvedValueOnce([
          { documentType: 'bike_registration', status: 'pending' },
          { documentType: 'driving_license', status: 'pending' },
          { documentType: 'id_card', status: 'verified' },
        ]),
      findOne: jest.fn(async (entity) => {
        if (entity === Users) return { id: 'user-1' };
        if (entity === Rider) return rider;
        return null;
      }),
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((_entity, value) => value),
      save: jest.fn().mockImplementation(async (_entity, value) => value),
    };
    const dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
    };
    const useCase = new UpdateRiderBikeUseCase(
      { findOne: jest.fn().mockResolvedValue(rider) } as never,
      {
        getLoggedInUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
      } as never,
      s3Service as never,
      dataSource as never,
    );

    await useCase.execute(
      {
        bikeBrand: ' Bajaj ',
        bikeModel: 'Boxer',
        bikeColor: 'Black',
        bikeYear: 2024,
        licensePlate: 'abc-123',
      },
      {
        bikeRegistration: image('registration.jpg'),
        riderPermit: image('permit.jpg'),
      },
    );

    expect(manager.save).toHaveBeenCalledWith(
      Rider,
      expect.objectContaining({
        bikeBrand: 'Bajaj',
        licensePlate: 'ABC-123',
        status: RiderStatus.DOCUMENT_VERIFICATION,
        isOnline: false,
      }),
    );
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['rider-documents:rider-1'],
    );
    expect(manager.save).toHaveBeenCalledWith(RiderDocument, expect.any(Array));
    expect(s3Service.deleteFileByUrl).toHaveBeenCalledWith(
      'https://old/registration',
    );
    expect(s3Service.deleteFileByUrl).toHaveBeenCalledWith(
      'https://old/permit',
    );
  });

  it('removes newly uploaded files when the database transaction fails', async () => {
    const s3Service = {
      uploadFiles: jest
        .fn()
        .mockResolvedValueOnce(['https://new/registration'])
        .mockResolvedValueOnce(['https://new/permit']),
      deleteFileByUrl: jest.fn().mockResolvedValue(undefined),
    };
    const useCase = new UpdateRiderBikeUseCase(
      { findOne: jest.fn().mockResolvedValue(rider) } as never,
      {
        getLoggedInUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
      } as never,
      s3Service as never,
      {
        transaction: jest.fn().mockRejectedValue(new Error('DB failed')),
      } as never,
    );

    await expect(
      useCase.execute(
        { bikeBrand: 'Bajaj' },
        {
          bikeRegistration: image('registration.jpg'),
          riderPermit: image('permit.jpg'),
        },
      ),
    ).rejects.toThrow('DB failed');
    expect(s3Service.deleteFileByUrl).toHaveBeenCalledWith(
      'https://new/registration',
    );
    expect(s3Service.deleteFileByUrl).toHaveBeenCalledWith(
      'https://new/permit',
    );
  });
});

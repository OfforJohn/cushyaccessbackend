import { Rider, RiderStatus, BikeType } from '../model/rider.entity';
import {
  DocumentStatus,
  DocumentType,
  RiderDocument,
} from '../model/rider-document.entity';
import { UserLocations } from 'src/users/model/user-locations.entity';
import { Users } from 'src/users/model/users.entity';
import { UploadRiderDocumentsUseCase } from './upload-rider-documents.usecase';

const image = (name: string) =>
  ({
    originalname: name,
    mimetype: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  }) as Express.Multer.File;

const payload = () => ({
  ninSlip: image('nin.jpg'),
  permitFront: image('permit-front.jpg'),
  permitBack: image('permit-back.jpg'),
  bikeRegistration: image('registration.jpg'),
  onboardingVersion: '2' as const,
  bikeType: 'Electric Bike',
  bikeBrand: '  Ampersand  ',
  bikeModel: '  E-One  ',
  bikeColor: '  Blue  ',
  licensePlate: ' ab-123 ',
  streetAddress: ' 12 Example Street ',
  city: ' Abuja ',
  state: ' FCT ',
  country: ' Nigeria ',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelationship: '',
});

describe('UploadRiderDocumentsUseCase', () => {
  const createContext = () => {
    const rider = {
      id: 'rider_1',
      userId: 'user_1',
      status: RiderStatus.PENDING,
    } as Rider;
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockImplementation(async (entity) => {
        if (entity === Users) return { id: 'user_1', locationId: null };
        if (entity === Rider) return rider;
        return null;
      }),
      delete: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn().mockImplementation((entity, value) => ({
        ...value,
        ...(entity === UserLocations ? { id: 'location_1' } : {}),
      })),
      save: jest.fn().mockImplementation(async (_entity, value) => value),
    };
    const dataSource = {
      transaction: jest.fn(
        async (operation: (transactionManager: unknown) => Promise<unknown>) =>
          operation(manager),
      ),
    };
    const s3Service = {
      uploadFiles: jest
        .fn()
        .mockImplementation(async ([file]: Express.Multer.File[]) => [
          `https://bucket.example/${file.originalname}`,
        ]),
      deleteFileByUrl: jest.fn().mockResolvedValue(undefined),
    };
    const useCase = new UploadRiderDocumentsUseCase(
      { findOne: jest.fn().mockResolvedValue(rider) } as never,
      {
        getLoggedInUser: jest.fn().mockResolvedValue({ id: 'user_1' }),
      } as never,
      s3Service as never,
      dataSource as never,
    );
    return { useCase, rider, manager, dataSource, s3Service };
  };

  it('stores all required documents, complete vehicle data, and rider address', async () => {
    const context = createContext();

    await context.useCase.execute(payload());

    expect(context.s3Service.uploadFiles).toHaveBeenCalledTimes(4);
    const savedDocumentCall = context.manager.save.mock.calls.find(
      ([entity]) => entity === RiderDocument,
    );
    expect(savedDocumentCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentType: DocumentType.ID_CARD,
          status: DocumentStatus.PENDING,
        }),
        expect.objectContaining({
          documentType: DocumentType.BIKE_REGISTRATION,
          status: DocumentStatus.PENDING,
        }),
      ]),
    );
    expect(
      savedDocumentCall?.[1].filter(
        (document: RiderDocument) =>
          document.documentType === DocumentType.DRIVING_LICENSE,
      ),
    ).toHaveLength(2);
    expect(context.rider).toEqual(
      expect.objectContaining({
        status: RiderStatus.DOCUMENT_VERIFICATION,
        bikeType: BikeType.ELECTRIC_BIKE,
        bikeBrand: 'Ampersand',
        bikeModel: 'E-One',
        bikeColor: 'Blue',
        licensePlate: 'AB-123',
      }),
    );
    expect(context.manager.create).toHaveBeenCalledWith(
      UserLocations,
      expect.objectContaining({
        address: '12 Example Street',
        city: 'abuja',
        state: 'FCT',
        country: 'Nigeria',
        addedBy: 'user_1',
      }),
    );
    expect(context.manager.update).toHaveBeenCalledWith(
      Users,
      { id: 'user_1' },
      { locationId: 'location_1' },
    );
    expect(context.manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['rider-documents:rider_1'],
    );
  });

  it('cleans up every successful parallel upload when one upload fails', async () => {
    const context = createContext();
    context.s3Service.uploadFiles
      .mockResolvedValueOnce(['https://bucket.example/nin.jpg'])
      .mockRejectedValueOnce(new Error('S3 unavailable'))
      .mockResolvedValueOnce(['https://bucket.example/permit-back.jpg'])
      .mockResolvedValueOnce(['https://bucket.example/registration.jpg']);

    await expect(context.useCase.execute(payload())).rejects.toThrow(
      'S3 unavailable',
    );

    expect(context.dataSource.transaction).not.toHaveBeenCalled();
    expect(context.s3Service.deleteFileByUrl).toHaveBeenCalledTimes(3);
  });

  it('keeps legacy three-document clients working during the OTA rollout', async () => {
    const context = createContext();
    const legacyPayload = payload() as any;
    delete legacyPayload.onboardingVersion;
    delete legacyPayload.bikeRegistration;
    delete legacyPayload.bikeBrand;
    delete legacyPayload.bikeModel;
    delete legacyPayload.bikeColor;
    delete legacyPayload.streetAddress;
    delete legacyPayload.city;
    delete legacyPayload.state;
    delete legacyPayload.country;

    await context.useCase.execute(legacyPayload);

    expect(context.s3Service.uploadFiles).toHaveBeenCalledTimes(3);
    expect(context.manager.delete).toHaveBeenCalledWith(
      RiderDocument,
      expect.objectContaining({
        riderId: 'rider_1',
        documentType: expect.anything(),
      }),
    );
    const deleteCriteria = context.manager.delete.mock.calls.find(
      ([entity]) => entity === RiderDocument,
    )?.[1];
    expect(deleteCriteria.documentType._value).not.toContain(
      DocumentType.BIKE_REGISTRATION,
    );
  });

  it('strictly rejects an incomplete version 2 onboarding payload', async () => {
    const context = createContext();
    const incompletePayload = payload() as any;
    incompletePayload.bikeRegistration = undefined;

    await expect(context.useCase.execute(incompletePayload)).rejects.toThrow(
      'Complete vehicle details, bike registration, and residential address are required',
    );

    expect(context.s3Service.uploadFiles).not.toHaveBeenCalled();
    expect(context.dataSource.transaction).not.toHaveBeenCalled();
  });
});

import { BadRequestException } from '@nestjs/common';
import { Users } from '../../users/model/users.entity';
import { Rider, RiderStatus } from '../model/rider.entity';
import {
  DocumentStatus,
  DocumentType,
  RiderDocument,
} from '../model/rider-document.entity';
import { UpdateRiderStatusUseCase } from './update-rider-status.usecase';

describe('UpdateRiderStatusUseCase', () => {
  const completeDocuments = () =>
    [
      {
        documentType: DocumentType.ID_CARD,
        status: DocumentStatus.VERIFIED,
      },
      {
        documentType: DocumentType.DRIVING_LICENSE,
        status: DocumentStatus.VERIFIED,
      },
      {
        documentType: DocumentType.BIKE_REGISTRATION,
        status: DocumentStatus.VERIFIED,
      },
    ] as RiderDocument[];

  const createContext = (documents = completeDocuments()) => {
    const rider = {
      id: 'rider_1',
      userId: 'user_1',
      status: RiderStatus.BACKGROUND_CHECK,
      backgroundCheckStatus: 'approved',
      trainingCompleted: true,
      metadata: {},
    } as Rider;
    const user = {
      id: 'user_1',
      email: 'rider@example.com',
      firstName: 'Test',
      lastName: 'Rider',
    } as Users;
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === Rider) return rider;
        if (entity === Users) return user;
        return null;
      }),
      find: jest.fn().mockResolvedValue(documents),
      save: jest.fn(async (_entity: unknown, value: unknown) => value),
    };
    const dataSource = {
      transaction: jest.fn((callback: (value: typeof manager) => unknown) =>
        callback(manager),
      ),
    };
    const mailSenderService = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    };
    const eventBus = { publish: jest.fn() };
    const useCase = new UpdateRiderStatusUseCase(
      mailSenderService as never,
      {
        getLoggedInUser: jest.fn().mockResolvedValue({ id: 'admin_1' }),
      } as never,
      dataSource as never,
      eventBus as never,
    );
    return {
      useCase,
      rider,
      manager,
      dataSource,
      mailSenderService,
      eventBus,
    };
  };

  it('rejects the obsolete document mutation fields before opening a transaction', async () => {
    const context = createContext();

    await expect(
      context.useCase.execute('rider_1', {
        status: RiderStatus.ACTIVE,
        documentId: 'doc_1',
        documentStatus: DocumentStatus.VERIFIED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(context.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('blocks activation if any required replacement document is unverified', async () => {
    const documents = completeDocuments();
    documents.push({
      documentType: DocumentType.DRIVING_LICENSE,
      status: DocumentStatus.PENDING,
    } as RiderDocument);
    const context = createContext(documents);

    await expect(
      context.useCase.execute('rider_1', { status: RiderStatus.ACTIVE }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(context.manager.save).not.toHaveBeenCalled();
    expect(context.eventBus.publish).not.toHaveBeenCalled();
  });

  it('locks the document workflow and trusts the authenticated admin identity', async () => {
    const context = createContext();

    const response = await context.useCase.execute('rider_1', {
      status: RiderStatus.ACTIVE,
      verifiedBy: 'spoofed_admin',
    });

    expect(context.manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['rider-documents:rider_1'],
    );
    expect(context.rider.status).toBe(RiderStatus.ACTIVE);
    expect(context.rider.approvedBy).toBe('admin_1');
    expect((response.toJSON().data as any).newStatus).toBe(RiderStatus.ACTIVE);
  });

  it('does not report a failed status update when a post-commit notification fails', async () => {
    const context = createContext();
    context.mailSenderService.sendMail.mockRejectedValueOnce(
      new Error('mail unavailable'),
    );

    const response = await context.useCase.execute('rider_1', {
      status: RiderStatus.ACTIVE,
    });

    expect((response.toJSON().data as any).newStatus).toBe(RiderStatus.ACTIVE);
  });
});

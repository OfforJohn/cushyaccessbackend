import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Rider, RiderStatus } from 'src/riders/model/rider.entity';
import {
  DocumentStatus,
  DocumentType,
  RiderDocument,
} from 'src/riders/model/rider-document.entity';
import { NotificationCategory } from '../../users/model/notification-category';
import { ReviewRiderDocumentUseCase } from './review-rider-document.usecase';

describe('ReviewRiderDocumentUseCase', () => {
  const createContext = (documentExists = true) => {
    const targetDocument = {
      id: 'doc_1',
      riderId: 'rider_1',
      documentType: DocumentType.ID_CARD,
      status: DocumentStatus.PENDING,
    } as RiderDocument;
    const rider = {
      id: 'rider_1',
      userId: 'user_1',
      status: RiderStatus.DOCUMENT_VERIFICATION,
      backgroundCheckStatus: 'approved',
      trainingCompleted: true,
      isOnline: false,
    } as Rider;
    const documents = [
      targetDocument,
      {
        documentType: DocumentType.DRIVING_LICENSE,
        status: DocumentStatus.VERIFIED,
      },
      {
        documentType: DocumentType.BIKE_REGISTRATION,
        status: DocumentStatus.VERIFIED,
      },
    ] as RiderDocument[];
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      findOne: jest
        .fn()
        .mockResolvedValueOnce(rider)
        .mockResolvedValueOnce(documentExists ? targetDocument : null),
      find: jest.fn().mockResolvedValue(documents),
      save: jest.fn().mockImplementation(async (_entity, value) => value),
    };
    const dataSource = {
      transaction: jest.fn(
        async (operation: (transactionManager: unknown) => Promise<unknown>) =>
          operation(manager),
      ),
    };
    const commonService = {
      getLoggedInUser: jest.fn().mockResolvedValue({ id: 'admin_1' }),
    };
    const eventBus = { publish: jest.fn() };
    const usersRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user_1',
        firstName: 'Ada',
        lastName: 'Rider',
        email: 'ada@example.com',
      }),
    };
    const mailSenderService = { sendMail: jest.fn().mockResolvedValue({}) };
    const useCase = new ReviewRiderDocumentUseCase(
      dataSource as never,
      commonService as never,
      eventBus as never,
      usersRepository as never,
      mailSenderService as never,
    );
    return {
      useCase,
      dataSource,
      manager,
      targetDocument,
      rider,
      eventBus,
      usersRepository,
      mailSenderService,
    };
  };

  it('reviews only a document scoped to the requested rider and activates when clear', async () => {
    const context = createContext();

    const response = await context.useCase.execute('rider_1', 'doc_1', {
      status: DocumentStatus.VERIFIED,
      notes: '  Clear and valid  ',
    });

    expect(context.manager.findOne).toHaveBeenNthCalledWith(
      1,
      Rider,
      expect.objectContaining({
        where: { id: 'rider_1' },
        lock: { mode: 'pessimistic_write' },
      }),
    );
    expect(context.manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['rider-documents:rider_1'],
    );
    expect(context.manager.findOne).toHaveBeenNthCalledWith(
      2,
      RiderDocument,
      expect.objectContaining({
        where: { id: 'doc_1', riderId: 'rider_1' },
        lock: { mode: 'pessimistic_write' },
      }),
    );
    expect(context.targetDocument.status).toBe(DocumentStatus.VERIFIED);
    expect(context.targetDocument.verificationNotes).toBe('Clear and valid');
    expect(context.targetDocument.verifiedBy).toBe('admin_1');
    expect(context.targetDocument.verifiedAt).toBeInstanceOf(Date);
    expect(context.rider.status).toBe(RiderStatus.ACTIVE);
    expect((response as any).data.riderStatus).toBe(RiderStatus.ACTIVE);
    expect(context.eventBus.publish).toHaveBeenCalledTimes(1);
    expect(context.eventBus.publish.mock.calls[0][0].notificationCategory).toBe(
      NotificationCategory.RIDER_STATUS_CHANGED,
    );
    expect(context.mailSenderService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: 'ada@example.com',
        subject: 'You are approved to deliver with Cushy Access',
        template: 'rider-verification',
      }),
    );
  });

  it('requires an explanatory note for rejection before opening a transaction', async () => {
    const context = createContext();

    await expect(
      context.useCase.execute('rider_1', 'doc_1', {
        status: DocumentStatus.REJECTED,
        notes: '   ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(context.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('treats an identical review retry as idempotent', async () => {
    const context = createContext();
    context.targetDocument.status = DocumentStatus.VERIFIED;
    context.targetDocument.verificationNotes = null;

    const response = await context.useCase.execute('rider_1', 'doc_1', {
      status: DocumentStatus.VERIFIED,
    });

    expect(context.manager.save).not.toHaveBeenCalled();
    expect(context.eventBus.publish).not.toHaveBeenCalled();
    expect(context.mailSenderService.sendMail).not.toHaveBeenCalled();
    expect((response.toJSON().data as any).changed).toBe(false);
  });

  it('does not report a failed review after a post-commit notification error', async () => {
    const context = createContext();
    context.eventBus.publish.mockImplementationOnce(() => {
      throw new Error('notification unavailable');
    });

    const response = await context.useCase.execute('rider_1', 'doc_1', {
      status: DocumentStatus.VERIFIED,
    });

    expect((response.toJSON().data as any).changed).toBe(true);
    expect(context.targetDocument.status).toBe(DocumentStatus.VERIFIED);
  });

  it('emails the rejection reason and replacement instruction', async () => {
    const context = createContext();

    await context.useCase.execute('rider_1', 'doc_1', {
      status: DocumentStatus.REJECTED,
      notes: 'The image is blurred',
    });

    expect(context.mailSenderService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Action required'),
        content: expect.objectContaining({
          rejectionReason: 'The image is blurred',
          status: 'REJECTED',
        }),
      }),
    );
  });

  it('does not allow a document belonging to another rider to be reviewed', async () => {
    const context = createContext(false);

    await expect(
      context.useCase.execute('rider_2', 'doc_1', {
        status: DocumentStatus.VERIFIED,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(context.manager.save).not.toHaveBeenCalled();
    expect(context.eventBus.publish).not.toHaveBeenCalled();
  });
});

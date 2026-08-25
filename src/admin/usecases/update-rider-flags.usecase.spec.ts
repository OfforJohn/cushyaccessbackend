import { BadRequestException } from '@nestjs/common';
import { Rider, RiderStatus } from '../../riders/model/rider.entity';
import {
  DocumentStatus,
  DocumentType,
  RiderDocument,
} from '../../riders/model/rider-document.entity';
import { NotificationCategory } from '../../users/model/notification-category';
import { UpdateRiderFlagsUseCase } from './update-rider-flags.usecase';

describe('UpdateRiderFlagsUseCase', () => {
  const createContext = (overrides: Partial<Rider> = {}) => {
    const rider = {
      id: 'rider_1',
      userId: 'user_1',
      status: RiderStatus.BACKGROUND_CHECK,
      isOnline: false,
      trainingCompleted: false,
      trainingCompletedAt: null,
      backgroundCheckStatus: 'pending',
      backgroundCheckCompletedAt: null,
      ...overrides,
    } as Rider;
    const documents = [
      DocumentType.ID_CARD,
      DocumentType.DRIVING_LICENSE,
      DocumentType.BIKE_REGISTRATION,
    ].map(
      (documentType) =>
        ({ documentType, status: DocumentStatus.VERIFIED }) as RiderDocument,
    );
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue(rider),
      find: jest.fn().mockResolvedValue(documents),
      save: jest.fn().mockImplementation(async (_entity, value) => value),
    };
    const dataSource = {
      transaction: jest.fn(async (operation: (manager: unknown) => unknown) =>
        operation(manager),
      ),
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
    const useCase = new UpdateRiderFlagsUseCase(
      dataSource as never,
      eventBus as never,
      usersRepository as never,
      mailSenderService as never,
    );
    return {
      useCase,
      rider,
      manager,
      dataSource,
      eventBus,
      mailSenderService,
    };
  };

  it('moves an approved background check to training and alerts the rider', async () => {
    const context = createContext();

    const response = await context.useCase.execute('rider_1', {
      backgroundCheckStatus: 'approved',
    });

    expect(context.manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['rider-documents:rider_1'],
    );
    expect(context.rider.status).toBe(RiderStatus.TRAINING);
    expect(context.rider.backgroundCheckCompletedAt).toBeInstanceOf(Date);
    expect(context.eventBus.publish.mock.calls[0][0].notificationCategory).toBe(
      NotificationCategory.RIDER_BACKGROUND_CHECK_APPROVED,
    );
    expect(context.mailSenderService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'rider-status' }),
    );
    expect((response.toJSON().data as any).status).toBe(RiderStatus.TRAINING);
  });

  it('activates a fully cleared rider and sends the final approval alert', async () => {
    const context = createContext({
      status: RiderStatus.TRAINING,
      backgroundCheckStatus: 'approved',
      backgroundCheckCompletedAt: new Date(),
    });

    await context.useCase.execute('rider_1', { trainingCompleted: true });

    expect(context.rider.status).toBe(RiderStatus.ACTIVE);
    expect(context.rider.trainingCompletedAt).toBeInstanceOf(Date);
    expect(context.eventBus.publish.mock.calls[0][0].notificationCategory).toBe(
      NotificationCategory.RIDER_STATUS_CHANGED,
    );
    expect(context.mailSenderService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'You are approved to deliver with Cushy Access',
      }),
    );
  });

  it('rejects an empty update before opening a transaction', async () => {
    const context = createContext();

    await expect(context.useCase.execute('rider_1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(context.dataSource.transaction).not.toHaveBeenCalled();
  });
});

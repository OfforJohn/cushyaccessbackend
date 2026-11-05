import { DailyReminderSchedulerService } from './daily-reminder-scheduler.service';

describe('DailyReminderSchedulerService', () => {
  const previousRole = process.env.APP_ROLE;

  const createHarness = () => {
    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const usersRepository = {
      query: jest.fn().mockResolvedValue([
        { userId: 'user-1', localDate: '2026-11-04' },
      ]),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    const notificationService = {
      sendToUser: jest.fn().mockResolvedValue({ sent: 1 }),
    };
    const service = new DailyReminderSchedulerService(
      usersRepository as any,
      notificationService as any,
    );

    return { service, usersRepository, notificationService, queryBuilder };
  };

  afterEach(() => {
    if (previousRole === undefined) delete process.env.APP_ROLE;
    else process.env.APP_ROLE = previousRole;
  });

  it('sends due reminders and records the local send date on the worker', async () => {
    process.env.APP_ROLE = 'worker';
    const harness = createHarness();

    await harness.service.sendDueDailyReminders();

    expect(harness.usersRepository.query).toHaveBeenCalledTimes(1);
    expect(harness.notificationService.sendToUser).toHaveBeenCalledWith(
      'user-1',
      'Your daily reminder',
      "It's time for your daily check-in.",
      { type: 'DAILY_REMINDER' },
    );
    expect(harness.queryBuilder.set).toHaveBeenCalledWith({
      dailyReminderLastSentDate: '2026-11-04',
    });
  });

  it('does not send reminders on an API instance', async () => {
    process.env.APP_ROLE = 'api';
    const harness = createHarness();

    await harness.service.sendDueDailyReminders();

    expect(harness.usersRepository.query).not.toHaveBeenCalled();
    expect(harness.notificationService.sendToUser).not.toHaveBeenCalled();
  });

  it('leaves the date unmarked when the push request fails', async () => {
    process.env.APP_ROLE = 'worker';
    const harness = createHarness();
    harness.notificationService.sendToUser.mockRejectedValue(
      new Error('Expo unavailable'),
    );

    await harness.service.sendDueDailyReminders();

    expect(harness.queryBuilder.update).not.toHaveBeenCalled();
  });
});

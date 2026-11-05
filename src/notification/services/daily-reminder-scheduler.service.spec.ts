import { DailyReminderSchedulerService } from './daily-reminder-scheduler.service';

describe('DailyReminderSchedulerService', () => {
  const createHarness = () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(async (sql: string) =>
        sql.includes('pg_try_advisory_lock')
          ? [{ acquired: true }]
          : [{ pg_advisory_unlock: true }],
      ),
      release: jest.fn().mockResolvedValue(undefined),
    };
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
    const dataSource = {
      createQueryRunner: jest.fn(() => queryRunner),
    };
    const service = new DailyReminderSchedulerService(
      usersRepository as any,
      notificationService as any,
      dataSource as any,
    );

    return {
      service,
      usersRepository,
      notificationService,
      queryBuilder,
      dataSource,
      queryRunner,
    };
  };

  it('sends due reminders on the API instance and records the local send date', async () => {
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
    expect(harness.queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('does not process reminders if another instance holds the scheduler lock', async () => {
    const harness = createHarness();
    harness.queryRunner.query.mockImplementationOnce(async () => [
      { acquired: false },
    ]);

    await harness.service.sendDueDailyReminders();

    expect(harness.usersRepository.query).not.toHaveBeenCalled();
    expect(harness.notificationService.sendToUser).not.toHaveBeenCalled();
    expect(harness.queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('leaves the date unmarked when the push request fails', async () => {
    const harness = createHarness();
    harness.notificationService.sendToUser.mockRejectedValue(
      new Error('Expo unavailable'),
    );

    await harness.service.sendDueDailyReminders();

    expect(harness.queryBuilder.update).not.toHaveBeenCalled();
  });
});

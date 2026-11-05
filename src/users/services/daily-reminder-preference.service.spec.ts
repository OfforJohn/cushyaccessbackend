import { BadRequestException } from '@nestjs/common';
import { DailyReminderPreferenceService } from './daily-reminder-preference.service';

describe('DailyReminderPreferenceService', () => {
  const createHarness = (user: Record<string, unknown> | null) => {
    const usersRepository = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn(async (value) => value),
    };
    const service = new DailyReminderPreferenceService(
      usersRepository as any,
    );

    return { service, usersRepository };
  };

  it('returns the saved preference for the authenticated user', async () => {
    const harness = createHarness({
      id: 'user-1',
      dailyReminderEnabled: true,
      dailyReminderTime: '08:30',
      dailyReminderTimeZone: 'Africa/Lagos',
    });

    await expect(harness.service.getPreference('user-1')).resolves.toEqual({
      enabled: true,
      time: '08:30',
      timeZone: 'Africa/Lagos',
    });
  });

  it('saves the enabled state, local time, and time zone', async () => {
    const user = {
      id: 'user-1',
      dailyReminderEnabled: false,
      dailyReminderTime: '09:00',
      dailyReminderTimeZone: 'UTC',
    };
    const harness = createHarness(user);

    await expect(
      harness.service.updatePreference('user-1', {
        enabled: true,
        time: '07:45',
        timeZone: 'America/Los_Angeles',
      }),
    ).resolves.toEqual({
      enabled: true,
      time: '07:45',
      timeZone: 'America/Los_Angeles',
    });
    expect(harness.usersRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        dailyReminderEnabled: true,
        dailyReminderTime: '07:45',
        dailyReminderTimeZone: 'America/Los_Angeles',
      }),
    );
  });

  it('rejects invalid time zones without saving', async () => {
    const harness = createHarness({
      id: 'user-1',
      dailyReminderEnabled: false,
      dailyReminderTime: '09:00',
      dailyReminderTimeZone: 'UTC',
    });

    await expect(
      harness.service.updatePreference('user-1', {
        enabled: true,
        time: '07:45',
        timeZone: 'Not/A_Timezone',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.usersRepository.save).not.toHaveBeenCalled();
  });
});

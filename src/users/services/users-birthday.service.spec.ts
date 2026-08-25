/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
import { Users } from '../model/users.entity';
import { UsersService } from './users.service';
import { getLagosCalendarYear } from '../birthday-policy';

describe('UsersService birthday updates', () => {
  const createHarness = (user: Partial<Users>) => {
    const queryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(user),
    };
    const transactionalRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn(() => transactionalRepository),
    };
    const usersRepository = {
      manager: {
        transaction: jest.fn(async (work) => work(manager)),
      },
    };
    const redisCacheService = {
      setItemInCache: jest.fn().mockResolvedValue(undefined),
      deleteCachedItem: jest.fn().mockResolvedValue(undefined),
    };
    const eventBus = {
      publish: jest.fn(),
    };
    const service = new UsersService(
      usersRepository as any,
      {} as any,
      redisCacheService as any,
      eventBus as any,
    );

    return {
      service,
      queryBuilder,
      transactionalRepository,
      redisCacheService,
      eventBus,
    };
  };

  it('locks the user row and increments the yearly change count', async () => {
    const currentYear = getLagosCalendarYear();
    const harness = createHarness({
      id: 'user-1',
      email: 'ada@example.com',
      mobile: '9012345678',
      dateOfBirth: '1990-01-01',
      dateOfBirthUpdateYear: currentYear,
      dateOfBirthUpdateCount: 0,
    });

    const result = await harness.service.updateDateOfBirth(
      'user-1',
      '1991-02-03',
    );

    expect(harness.queryBuilder.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
    );
    expect(harness.transactionalRepository.save).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      dateOfBirth: '1991-02-03',
      birthdayUpdatesRemaining: 0,
    });
    expect(harness.redisCacheService.deleteCachedItem).toHaveBeenCalledWith(
      'user:email:mobile:ada@example.com',
    );
    expect(harness.eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('rejects a second change in the same calendar year', async () => {
    const harness = createHarness({
      id: 'user-1',
      dateOfBirth: '1990-01-01',
      dateOfBirthUpdateYear: getLagosCalendarYear(),
      dateOfBirthUpdateCount: 1,
    });

    await expect(
      harness.service.updateDateOfBirth('user-1', '1991-02-03'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.transactionalRepository.save).not.toHaveBeenCalled();
    expect(harness.eventBus.publish).not.toHaveBeenCalled();
  });

  it('treats saving the current birthday as idempotent', async () => {
    const harness = createHarness({
      id: 'user-1',
      email: 'ada@example.com',
      mobile: '9012345678',
      dateOfBirth: '1990-01-01',
      dateOfBirthUpdateYear: getLagosCalendarYear(),
      dateOfBirthUpdateCount: 1,
    });

    const result = await harness.service.updateDateOfBirth(
      'user-1',
      '1990-01-01',
    );

    expect(harness.transactionalRepository.save).not.toHaveBeenCalled();
    expect(result.birthdayUpdatesRemaining).toBe(0);
    expect(harness.eventBus.publish).not.toHaveBeenCalled();
  });

  it('allows one new change when the Lagos calendar year changes', async () => {
    const currentYear = getLagosCalendarYear();
    const harness = createHarness({
      id: 'user-1',
      dateOfBirth: '1990-01-01',
      dateOfBirthUpdateYear: currentYear - 1,
      dateOfBirthUpdateCount: 1,
    });

    const result = await harness.service.updateDateOfBirth(
      'user-1',
      '1991-02-03',
    );

    expect(result.birthdayUpdatesRemaining).toBe(0);
    expect(harness.transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        dateOfBirthUpdateYear: currentYear,
        dateOfBirthUpdateCount: 1,
      }),
    );
  });

  it('uses the Lagos calendar year at the UTC New Year boundary', () => {
    expect(getLagosCalendarYear(new Date('2026-12-31T23:30:00.000Z'))).toBe(
      2027,
    );
  });
});

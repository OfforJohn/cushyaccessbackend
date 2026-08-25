/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
import { Rider, RiderStatus } from '../model/rider.entity';
import { ToggleOnlineStatusUseCase } from './toggle-online-status.usecase';

describe('ToggleOnlineStatusUseCase', () => {
  const createHarness = (authenticatedUserId = 'user-id') => {
    const rider = {
      id: 'rider-id',
      userId: 'user-id',
      status: RiderStatus.ACTIVE,
      trainingCompleted: true,
      backgroundCheckStatus: 'approved',
      isOnline: false,
    } as Rider;
    const repository = {
      findOne: jest.fn(async () => rider),
      save: jest.fn(async (value: Rider) => value),
    };
    const commonService = {
      getLoggedInUser: jest.fn(async () => ({ id: authenticatedUserId })),
    };
    const eventBus = { publish: jest.fn() };
    const useCase = new ToggleOnlineStatusUseCase(
      repository as never,
      commonService as never,
      eventBus as never,
    );
    return { useCase, rider, repository };
  };

  it('changes only the authenticated rider status', async () => {
    const { useCase, rider, repository } = createHarness();

    await useCase.execute('user-id', true);

    expect(rider.isOnline).toBe(true);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
    });
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('rejects an attempt to change another rider status', async () => {
    const { useCase, repository } = createHarness('signed-in-user');

    await expect(useCase.execute('another-user', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.findOne).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
});

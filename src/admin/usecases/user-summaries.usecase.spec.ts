/// <reference types="jest" />

import { UserRoles } from 'src/users/model/user-roles.enum';
import { UserSummariesUseCase } from './user-summaries.usecase';

describe('UserSummariesUseCase wallet reporting', () => {
  const createHarness = (wallet: { walletBalance: number } | null) => {
    const user = {
      id: 'usr-customer',
      firstName: 'Ada',
      lastName: 'User',
      callingCode: '234',
      mobile: '8000000000',
      email: 'ada@example.test',
      location: null,
      isVerified: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      userRole: UserRoles.CUSTOMER,
      orders: [],
      wallet,
    };
    const usersQuery = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      loadRelationCountAndMap: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[user], 1]),
    };
    const activityQuery = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const service = new UserSummariesUseCase(
      { createQueryBuilder: jest.fn(() => usersQuery) } as never,
      { createQueryBuilder: jest.fn(() => activityQuery) } as never,
    );
    return service;
  };

  it('distinguishes an uninitialized wallet from a zero balance', async () => {
    const result = await createHarness(null).execute();

    expect(result.users[0]).toEqual(
      expect.objectContaining({ hasWallet: false, walletBalance: null }),
    );
  });

  it('returns the exact initialized wallet balance', async () => {
    const result = await createHarness({ walletBalance: 1250.75 }).execute();

    expect(result.users[0]).toEqual(
      expect.objectContaining({ hasWallet: true, walletBalance: 1250.75 }),
    );
  });

  it('distinguishes an initialized zero balance from no wallet', async () => {
    const result = await createHarness({ walletBalance: 0 }).execute();

    expect(result.users[0]).toEqual(
      expect.objectContaining({ hasWallet: true, walletBalance: 0 }),
    );
  });
});

/// <reference types="jest" />

import { UserRoles } from 'src/users/model/user-roles.enum';
import { TotalBalanceUseCase } from './total-balance.usecase';

describe('TotalBalanceUseCase', () => {
  it('returns one exact role breakdown, total, and wallet counts', async () => {
    const queryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          role: UserRoles.CUSTOMER,
          balance: '321557.24',
          walletCount: '694',
          accountCount: '983',
        },
        {
          role: UserRoles.VENDOR,
          balance: '10.10',
          walletCount: '22',
          accountCount: '25',
        },
        {
          role: UserRoles.DOCTOR,
          balance: '40.00',
          walletCount: '14',
          accountCount: '15',
        },
      ]),
    };
    const repository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    const service = new TotalBalanceUseCase(repository as never);

    await expect(service.executeSnapshot()).resolves.toEqual({
      total: 321607.34,
      breakdown: {
        users: 321557.24,
        merchants: 10.1,
        healthProfessionals: 40,
      },
      walletCounts: {
        users: 694,
        merchants: 22,
        healthProfessionals: 14,
      },
      accountCounts: {
        users: 983,
        merchants: 25,
        healthProfessionals: 15,
      },
    });
    expect(queryBuilder.getRawMany).toHaveBeenCalledTimes(1);
  });
});

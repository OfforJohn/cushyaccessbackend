/// <reference types="jest" />

import { UserRoles } from 'src/users/model/user-roles.enum';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService user age distribution', () => {
  it('aggregates valid customer birthdays and reports coverage separately', async () => {
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { bucket: 'UNDER_18', count: '2' },
        { bucket: '18_24', count: '3' },
        { bucket: '25_34', count: '5' },
        { bucket: 'NOT_PROVIDED', count: '8' },
        { bucket: 'INVALID', count: '2' },
      ]),
    };
    const usersRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const service = new AnalyticsService(
      {} as never,
      {} as never,
      usersRepository as never,
    );

    const result = await service.getUserAgeDistribution();

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'account.userRole = :role',
      { role: UserRoles.CUSTOMER },
    );
    expect(result).toEqual(
      expect.objectContaining({
        totalUsers: 20,
        suppliedBirthdays: 10,
        notProvided: 8,
        invalid: 2,
        coveragePercentage: 50,
      }),
    );
    expect(result.buckets.slice(0, 3)).toEqual([
      expect.objectContaining({ key: 'UNDER_18', count: 2, percentage: 20 }),
      expect.objectContaining({ key: '18_24', count: 3, percentage: 30 }),
      expect.objectContaining({ key: '25_34', count: 5, percentage: 50 }),
    ]);
    expect(result.buckets).toHaveLength(7);
  });
});

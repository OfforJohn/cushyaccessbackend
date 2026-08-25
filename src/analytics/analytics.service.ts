// analytics/services/analytics.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Analytics } from './entities/analytics.entity';
import { UserActivity } from './entities/user-activity.entity';
import { Users } from 'src/users/model/users.entity';
import { StandardResponse } from 'src/common/module/standard-response';
import { UserRoles } from 'src/users/model/user-roles.enum';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(Analytics)
    private analyticsRepository: Repository<Analytics>,
    @InjectRepository(UserActivity)
    private userActivityRepository: Repository<UserActivity>,
    @InjectRepository(Users)
    private usersRepository: Repository<Users>,
  ) {}

  async trackUserActivity(
    userId: string,
    activityType: string,
    metadata?: Record<string, any>,
  ): Promise<UserActivity> {
    const activity = this.userActivityRepository.create({
      userId,
      activityType,
      metadata,
    });
    return this.userActivityRepository.save(activity);
  }

  async getNewUsersPerDay(date: Date): Promise<number> {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const count = await this.usersRepository.count({
      where: {
        createdAt: Between(startDate, endDate),
      },
    });

    await this.saveDailyMetric(date, 'new_users', count);
    return count;
  }

  async getReturningUsers(date: Date, daysToLookBack = 7): Promise<number> {
    const startDate = new Date(date);
    startDate.setDate(startDate.getDate() - daysToLookBack);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() - 1);
    endDate.setHours(23, 59, 59, 999);

    const previousPeriodStart = new Date(startDate);
    previousPeriodStart.setDate(previousPeriodStart.getDate() - daysToLookBack);

    // Get users active in previous period
    const previousActiveUsers = await this.userActivityRepository
      .createQueryBuilder('activity')
      .select('DISTINCT activity.userId')
      .where('activity.createdAt BETWEEN :prevStart AND :prevEnd', {
        prevStart: previousPeriodStart,
        prevEnd: startDate,
      })
      .getRawMany();

    const previousUserIds = previousActiveUsers.map((u) => u.userId);

    if (previousUserIds.length === 0) {
      await this.saveDailyMetric(date, 'returning_users', 0);
      return 0;
    }

    // Get users from previous period who are active in current period
    const returningUsers = await this.userActivityRepository
      .createQueryBuilder('activity')
      .select('DISTINCT activity.userId')
      .where('activity.userId IN (:...userIds)', { userIds: previousUserIds })
      .andWhere('activity.createdAt BETWEEN :start AND :end', {
        start: startDate,
        end: endDate,
      })
      .getRawMany();

    const count = returningUsers.length;
    await this.saveDailyMetric(date, 'returning_users', count);
    return count;
  }

  async getChurnedUsers(date: Date, inactiveDays = 30): Promise<number> {
    const cutoffDate = new Date(date);
    cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);
    cutoffDate.setHours(23, 59, 59, 999);

    const churnCutoff = new Date(cutoffDate);
    churnCutoff.setDate(churnCutoff.getDate() - 1); // Active before cutoff

    // Get all users
    const allUsers = await this.usersRepository.find({
      select: ['id'],
    });

    if (allUsers.length === 0) {
      await this.saveDailyMetric(date, 'churned_users', 0);
      return 0;
    }

    const userIds = allUsers.map((user) => user.id);

    // Get users with activity after the churn cutoff
    const activeUsers = await this.userActivityRepository
      .createQueryBuilder('activity')
      .select('DISTINCT activity.userId')
      .where('activity.userId IN (:...userIds)', { userIds })
      .andWhere('activity.createdAt > :cutoff', { cutoff: churnCutoff })
      .getRawMany();

    const activeUserIds = activeUsers.map((u) => u.userId);
    const churnedUsers = userIds.filter((id) => !activeUserIds.includes(id));

    const count = churnedUsers.length;
    await this.saveDailyMetric(date, 'churned_users', count);
    return count;
  }

  async getFrequentOrderUsers(
    date: Date,
    minOrders = 3,
    periodDays = 30,
  ): Promise<number> {
    const startDate = new Date(date);
    startDate.setDate(startDate.getDate() - periodDays);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const frequentUsers = await this.userActivityRepository
      .createQueryBuilder('activity')
      .select('activity.userId, COUNT(activity.id) as order_count')
      .where('activity.activityType = :type', { type: 'order_placed' })
      .andWhere('activity.createdAt BETWEEN :start AND :end', {
        start: startDate,
        end: endDate,
      })
      .groupBy('activity.userId')
      .having('COUNT(activity.id) >= :minOrders', { minOrders })
      .getRawMany();

    return frequentUsers.length;
  }

  async getOrdersPerUser(date: Date): Promise<{ [key: string]: number }> {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const ordersPerUser = await this.userActivityRepository
      .createQueryBuilder('activity')
      .select('activity.userId, COUNT(activity.id) as order_count')
      .where('activity.activityType = :type', { type: 'order_placed' })
      .andWhere('activity.createdAt BETWEEN :start AND :end', {
        start: startDate,
        end: endDate,
      })
      .groupBy('activity.userId')
      .getRawMany();

    const result = {};
    ordersPerUser.forEach((item) => {
      result[item.userId] = parseInt(item.order_count, 10);
    });

    return result;
  }

  async getUserAgeDistribution() {
    const lagosToday = `(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date`;
    const ageInYears = `EXTRACT(YEAR FROM age(${lagosToday}, account."dateOfBirth"))::int`;
    const bucketExpression = `CASE
      WHEN account."dateOfBirth" IS NULL THEN 'NOT_PROVIDED'
      WHEN account."dateOfBirth" > ${lagosToday}
        OR account."dateOfBirth" < ${lagosToday} - INTERVAL '120 years'
        THEN 'INVALID'
      WHEN ${ageInYears} < 18 THEN 'UNDER_18'
      WHEN ${ageInYears} BETWEEN 18 AND 24 THEN '18_24'
      WHEN ${ageInYears} BETWEEN 25 AND 34 THEN '25_34'
      WHEN ${ageInYears} BETWEEN 35 AND 44 THEN '35_44'
      WHEN ${ageInYears} BETWEEN 45 AND 54 THEN '45_54'
      WHEN ${ageInYears} BETWEEN 55 AND 64 THEN '55_64'
      ELSE '65_PLUS'
    END`;

    const rows: Array<{ bucket: string; count: string | number }> =
      await this.usersRepository
        .createQueryBuilder('account')
        .select(bucketExpression, 'bucket')
        .addSelect('COUNT(account.id)', 'count')
        .where('account.userRole = :role', { role: UserRoles.CUSTOMER })
        .groupBy(bucketExpression)
        .getRawMany();

    const counts = new Map<string, number>(
      rows.map((row) => {
        const parsed = Number(row.count);
        return [
          row.bucket,
          Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0,
        ] as [string, number];
      }),
    );
    const definitions = [
      { key: 'UNDER_18', label: 'Under 18' },
      { key: '18_24', label: '18–24' },
      { key: '25_34', label: '25–34' },
      { key: '35_44', label: '35–44' },
      { key: '45_54', label: '45–54' },
      { key: '55_64', label: '55–64' },
      { key: '65_PLUS', label: '65+' },
    ] as const;
    const suppliedBirthdays = definitions.reduce(
      (sum, bucket) => sum + (counts.get(bucket.key) || 0),
      0,
    );
    const notProvided = counts.get('NOT_PROVIDED') || 0;
    const invalid = counts.get('INVALID') || 0;
    const totalUsers = suppliedBirthdays + notProvided + invalid;
    const buckets = definitions.map((bucket) => {
      const count = counts.get(bucket.key) || 0;
      return {
        ...bucket,
        count,
        percentage:
          suppliedBirthdays > 0
            ? Math.round((count / suppliedBirthdays) * 1000) / 10
            : 0,
      };
    });

    return {
      asOf: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
      totalUsers,
      suppliedBirthdays,
      notProvided,
      invalid,
      coveragePercentage:
        totalUsers > 0
          ? Math.round((suppliedBirthdays / totalUsers) * 1000) / 10
          : 0,
      buckets,
    };
  }

  async getDailyMetrics(date: Date) {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const metrics = await this.analyticsRepository.find({
      where: {
        date: Between(startDate, endDate),
      },
    });

    const result = metrics.reduce((acc, metric) => {
      acc[metric.metricType] = metric.value;
      return acc;
    }, {});
    return new StandardResponse(
      false,
      'Daily metrics retrieved successfully',
      result,
    );
  }

  async getMetricsRange(startDate: Date, endDate: Date, metricType?: string) {
    const where: any = {
      date: Between(startDate, endDate),
    };

    if (metricType) {
      where.metricType = metricType;
    }

    const metrics = await this.analyticsRepository.find({
      where,
      order: { date: 'ASC' },
    });
    return new StandardResponse(
      false,
      'Metrics range retrieved successfully',
      metrics,
    );
  }

  private async saveDailyMetric(
    date: Date,
    metricType: string,
    value: number,
  ): Promise<void> {
    const formattedDate = new Date(date);
    formattedDate.setHours(0, 0, 0, 0);

    const existing = await this.analyticsRepository.findOne({
      where: {
        date: formattedDate,
        metricType,
      },
    });

    if (existing) {
      existing.value = value;
      await this.analyticsRepository.save(existing);
    } else {
      const metric = this.analyticsRepository.create({
        date: formattedDate,
        metricType,
        value,
      });
      await this.analyticsRepository.save(metric);
    }
  }
}

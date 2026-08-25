// src/admin/usecases/active-users.usecase.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Orders } from 'src/orders/model/order.entity';
import { UserRoles } from 'src/users/model/user-roles.enum';

@Injectable()
export class ActiveUsersUseCase {
  constructor(
    @InjectRepository(Orders)
    private readonly ordersRepository: Repository<Orders>,
  ) {}

  private normalizeDays(days?: number | string) {
    let daysNum = 100; // default now is 100
    if (typeof days === 'string') {
      const parsed = parseInt(days, 10);
      if (!isNaN(parsed) && parsed > 0) daysNum = parsed;
    } else if (typeof days === 'number' && days > 0) {
      daysNum = days;
    }

    return daysNum;
  }

  private parseTotal(raw: Record<string, unknown> | undefined) {
    const totalUserStr =
      (raw && (raw.totalUser ?? raw.totaluser ?? raw.count)) ?? '0';
    return Number.isFinite(Number(totalUserStr))
      ? parseInt(totalUserStr as string, 10)
      : 0;
  }

  /**
   * Count distinct users who placed at least one order in the last `days` days.
   * Default = 100 days.
   */
  async execute(days?: number | string, roles?: UserRoles[]) {
    const daysNum = this.normalizeDays(days);
    const startDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);

    const query = this.ordersRepository
      .createQueryBuilder('orders')
      .innerJoin('orders.user', 'account')
      .select('COUNT(DISTINCT orders.userId)', 'totalUser')
      .where('orders.createdAt >= :startDate', { startDate });

    if (roles?.length) {
      query.andWhere('account.userRole IN (:...roles)', { roles });
    }

    return this.parseTotal(await query.getRawOne());
  }

  async executeByUserCategory(days?: number | string) {
    const daysNum = this.normalizeDays(days);
    const startDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
    const managedRoles = [UserRoles.CUSTOMER, UserRoles.VENDOR, UserRoles.DOCTOR];

    const rows: { role: UserRoles; count: string | number | null }[] =
      await this.ordersRepository
        .createQueryBuilder('orders')
        .innerJoin('orders.user', 'account')
        .select('account.userRole', 'role')
        .addSelect('COUNT(DISTINCT orders.userId)', 'count')
        .where('orders.createdAt >= :startDate', { startDate })
        .andWhere('account.userRole IN (:...roles)', { roles: managedRoles })
        .groupBy('account.userRole')
        .getRawMany();

    const countByRole = new Map<UserRoles, number>();
    rows.forEach((row) => {
      const value = Number(row.count);
      countByRole.set(row.role, isNaN(value) ? 0 : value);
    });

    return {
      users: countByRole.get(UserRoles.CUSTOMER) || 0,
      merchants: countByRole.get(UserRoles.VENDOR) || 0,
      healthProfessionals: countByRole.get(UserRoles.DOCTOR) || 0,
    };
  }
}

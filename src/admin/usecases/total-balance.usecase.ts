import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from 'src/users/model/users.entity';
import { UserRoles } from 'src/users/model/user-roles.enum';

export interface WalletBalanceBreakdown {
  users: number;
  merchants: number;
  healthProfessionals: number;
}

export interface WalletCountBreakdown {
  users: number;
  merchants: number;
  healthProfessionals: number;
}

export interface WalletBalanceSnapshot {
  total: number;
  breakdown: WalletBalanceBreakdown;
  walletCounts: WalletCountBreakdown;
  accountCounts: WalletCountBreakdown;
}

@Injectable()
export class TotalBalanceUseCase {
  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
  ) {}

  /**
   * Returns balances and wallet coverage from one database snapshot. Only
   * customer, merchant, and doctor wallets are dashboard liabilities;
   * internal and rider wallets are intentionally reported elsewhere.
   */
  async executeSnapshot(): Promise<WalletBalanceSnapshot> {
    const rows: {
      role: UserRoles;
      balance: string | number | null;
      walletCount: string | number | null;
      accountCount: string | number | null;
    }[] = await this.usersRepository
      .createQueryBuilder('walletOwner')
      .leftJoin('walletOwner.wallet', 'wallet')
      .select('walletOwner.userRole', 'role')
      .addSelect('COALESCE(SUM(wallet.walletBalance), 0)', 'balance')
      .addSelect('COUNT(wallet.id)', 'walletCount')
      .addSelect('COUNT(walletOwner.id)', 'accountCount')
      .where('walletOwner.userRole IN (:...roles)', {
        roles: [UserRoles.CUSTOMER, UserRoles.VENDOR, UserRoles.DOCTOR],
      })
      .groupBy('walletOwner.userRole')
      .getRawMany();

    const balances = new Map<UserRoles, number>();
    const counts = new Map<UserRoles, number>();
    const accountCountsByRole = new Map<UserRoles, number>();
    for (const row of rows) {
      balances.set(row.role, this.toMoney(row.balance));
      counts.set(row.role, this.toCount(row.walletCount));
      accountCountsByRole.set(row.role, this.toCount(row.accountCount));
    }

    const breakdown = {
      users: balances.get(UserRoles.CUSTOMER) || 0,
      merchants: balances.get(UserRoles.VENDOR) || 0,
      healthProfessionals: balances.get(UserRoles.DOCTOR) || 0,
    };
    const walletCounts = {
      users: counts.get(UserRoles.CUSTOMER) || 0,
      merchants: counts.get(UserRoles.VENDOR) || 0,
      healthProfessionals: counts.get(UserRoles.DOCTOR) || 0,
    };
    const accountCounts = {
      users: accountCountsByRole.get(UserRoles.CUSTOMER) || 0,
      merchants: accountCountsByRole.get(UserRoles.VENDOR) || 0,
      healthProfessionals: accountCountsByRole.get(UserRoles.DOCTOR) || 0,
    };

    const totalInMinorUnits = Object.values(breakdown).reduce(
      (sum, value) => sum + Math.round(value * 100),
      0,
    );
    return {
      total: totalInMinorUnits / 100,
      breakdown,
      walletCounts,
      accountCounts,
    };
  }

  private toMoney(value: string | number | null) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
  }

  private toCount(value: string | number | null) {
    const count = Number(value || 0);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  }
}

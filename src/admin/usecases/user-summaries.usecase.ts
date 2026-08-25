import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Users } from 'src/users/model/users.entity';
import { UserActivity } from 'src/analytics/entities/user-activity.entity';
import { UserRoles } from 'src/users/model/user-roles.enum';

@Injectable()
export class UserSummariesUseCase {
  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(UserActivity)
    private readonly userActivityRepository: Repository<UserActivity>,
  ) {}

  async execute(page = 1, size = 10, search?: string, roles?: UserRoles[]) {
    const normalizedPage = Math.max(Number(page) || 1, 1);
    const normalizedSize = Math.min(Math.max(Number(size) || 10, 1), 1000);
    const normalizedSearch = search?.trim();
    const managedRoles = [
      UserRoles.CUSTOMER,
      UserRoles.VENDOR,
      UserRoles.DOCTOR,
      UserRoles.RIDER,
    ];
    const requestedRoles = roles?.filter((role) => managedRoles.includes(role));
    const queryRoles = requestedRoles?.length
      ? requestedRoles
      : [UserRoles.CUSTOMER];

    const queryBuilder = this.usersRepository
      .createQueryBuilder('account')
      .leftJoinAndSelect('account.location', 'location')
      .leftJoinAndSelect('account.wallet', 'wallet')
      .select([
        'account.id',
        'account.firstName',
        'account.lastName',
        'account.callingCode',
        'account.mobile',
        'account.email',
        'account.isVerified',
        'account.createdAt',
        'account.updatedAt',
        'account.userRole',
        'location.id',
        'location.address',
        'location.state',
        'location.country',
        'wallet.id',
        'wallet.walletBalance',
      ])
      .loadRelationCountAndMap('account.ordersCount', 'account.orders')
      .where('account.userRole IN (:...managedRoles)', {
        managedRoles: queryRoles,
      })
      .orderBy('account.createdAt', 'DESC')
      .addOrderBy('account.id', 'ASC')
      .skip((normalizedPage - 1) * normalizedSize)
      .take(normalizedSize);

    if (normalizedSearch) {
      queryBuilder.andWhere(
        `(
                    LOWER(account.firstName) LIKE :search OR
                    LOWER(account.lastName) LIKE :search OR
                    LOWER(CONCAT(COALESCE(account.firstName, ''), ' ', COALESCE(account.lastName, ''))) LIKE :search OR
                    LOWER(account.email) LIKE :search OR
                    account.mobile LIKE :rawSearch
                )`,
        {
          search: `%${normalizedSearch.toLowerCase()}%`,
          rawSearch: `%${normalizedSearch}%`,
        },
      );
    }

    const [users, total] = await queryBuilder.getManyAndCount();

    // Batch-fetch the most recent activity date for the current page. Wallets
    // are joined into the paginated user query to avoid a stale second read.
    const userIds = users.map((u) => u.id);
    const lastActivityMap = new Map<string, Date>();

    if (userIds.length > 0) {
      const rows: { userId: string; lastActivity: string }[] =
        await this.userActivityRepository
          .createQueryBuilder('ua')
          .select('ua.userId', 'userId')
          .addSelect('MAX(ua.createdAt)', 'lastActivity')
          .where('ua.userId IN (:...userIds)', { userIds })
          .groupBy('ua.userId')
          .getRawMany();

      for (const row of rows) {
        lastActivityMap.set(row.userId, new Date(row.lastActivity));
      }
    }

    const data = users.map((user) => {
      // Use the MORE RECENT of: last activity event vs user.updatedAt
      const activityDate = lastActivityMap.get(user.id);
      const updatedAt = new Date(user.updatedAt);
      const bestDate =
        activityDate && activityDate > updatedAt ? activityDate : updatedAt;

      return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: `${user.firstName} ${user.lastName}`,
        mobile: user.mobile,
        phone: `+${user.callingCode} ${user.mobile}`,
        email: user.email,
        location: user.location
          ? `${user.location.address}, ${user.location.state}, ${user.location.country}`
          : 'N/A',
        status: user.isVerified ? 'Active' : 'Inactive',
        isVerified: user.isVerified,
        hasWallet: Boolean(user.wallet),
        walletBalance: user.wallet
          ? Number(user.wallet.walletBalance || 0)
          : null,
        ordersCount: (user as any).ordersCount || user.orders?.length || 0,
        lastActive: this.timeAgo(bestDate),
        createdAt: user.createdAt,
        userRole: user.userRole,
      };
    });

    return {
      users: data,
      pagination: {
        total,
        page: normalizedPage,
        size: normalizedSize,
        pageCount: Math.ceil(total / normalizedSize),
      },
    };
  }

  private timeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    const hours = Math.floor(seconds / 3600);

    if (hours < 1) return 'Just now';
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;

    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
}

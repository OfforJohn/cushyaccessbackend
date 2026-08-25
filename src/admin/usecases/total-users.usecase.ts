import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Users } from 'src/users/model/users.entity';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { StandardResponse } from 'src/common/module/standard-response';
import { Injectable } from '@nestjs/common';

@Injectable()
export class UserCountUsecase {
  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
  ) {}

  async execute() {
    const totalUser = await this.usersRepository.count({
      where: { userRole: In([UserRoles.CUSTOMER, UserRoles.VENDOR, UserRoles.DOCTOR]) },
    });

    return totalUser;
  }

  async executeByUserCategory() {
    const rows: { role: UserRoles; count: string | number | null }[] =
      await this.usersRepository
        .createQueryBuilder('account')
        .select('account.userRole', 'role')
        .addSelect('COUNT(account.id)', 'count')
        .where('account.userRole IN (:...roles)', {
          roles: [UserRoles.CUSTOMER, UserRoles.VENDOR, UserRoles.DOCTOR],
        })
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

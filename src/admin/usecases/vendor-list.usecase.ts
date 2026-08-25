import { Between, In, Repository } from 'typeorm';
import { StandardResponse } from '../../common/module/standard-response';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from 'src/users/model/users.entity';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { VendorListDto } from '../dto/vendor-list.dto';

@Injectable()
export class VendorListUseCase {
    constructor(
        @InjectRepository(Users) private userRepository: Repository<Users>,
    ) { }

    async execute(filter: VendorListDto): Promise<StandardResponse> {
        const page = filter.page ?? 1;
        const size = filter.size ?? 10;

        const queryBuilder = this.userRepository.createQueryBuilder('user')
            .leftJoinAndSelect('user.store', 'store')
            .where('user.userRole = :role', { role: UserRoles.VENDOR });

        // Filter by status
        if (filter.status === 'VERIFIED') {
            queryBuilder.andWhere('user.isVerified = :status', { status: true });
        } else if (filter.status === 'UNVERIFIED') {
            queryBuilder.andWhere('user.isVerified = :status', { status: false });
        }

        // Filter by date range
        if (filter.createdFrom && filter.createdTo) {
            queryBuilder.andWhere('user.createdAt BETWEEN :from AND :to', {
                from: filter.createdFrom,
                to: filter.createdTo,
            });
        } else if (filter.createdFrom) {
            queryBuilder.andWhere('user.createdAt >= :from', {
                from: filter.createdFrom,
            });
        } else if (filter.createdTo) {
            queryBuilder.andWhere('user.createdAt <= :to', {
                to: filter.createdTo,
            });
        }

        // Pagination
        queryBuilder.skip((page - 1) * size).take(size);

        const [vendorList, total] = await queryBuilder.getManyAndCount();

        const statusPrefix = filter.status ? `${filter.status}_` : '';
        const message = `${statusPrefix}VENDOR_LIST_FETCHED_SUCCESSFULLY`;

        return new StandardResponse(false, message, {
            vendorList,
            pagination: {
                total,
                page,
                size,
                pageCount: Math.ceil(total / size),
            },
        });
    }
}

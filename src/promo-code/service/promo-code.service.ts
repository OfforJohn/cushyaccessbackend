import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PromoCodes } from '../model/promo-code.entity';
import { StandardResponse } from '../../common/module/standard-response';
import { UsersService } from '../../users/services/users.service';
import { PromoCodeMapper } from './promo-code.mapper';
import { CreatePromoCodeDto } from '../dto/create-promo-code.dto';
import { PromoCodeResponseDto } from '../dto/promo-code.response';
import { UpdatePromoCodeDto } from '../dto/update-promo-code.dto';
import { Users } from '../../users/model/users.entity';
import { PaginationRequest } from '../../common/module/pagination-request';
import { Coupon, CouponSource, CouponStatus } from '../model/coupon.entity';
import { CreateCouponDto } from '../dto/create-coupon.dto';
import { CouponRedemption } from '../model/coupon-redemption.entity';
import { Orders } from 'src/orders/model/order.entity';
import { UserRoles } from 'src/users/model/user-roles.enum';

@Injectable()
export class PromoCodeService {
  constructor(
    @InjectRepository(Coupon) private couponRepo: Repository<Coupon>,
    @InjectRepository(Users)
    private usersRepo: Repository<Users>,
    @InjectRepository(PromoCodes)
    private readonly promoCodeRepo: Repository<PromoCodes>,
    private readonly userService: UsersService,
  ) {}

  private readonly PROMO_CODE_LENGTH = 6;

  async createPromoCode(
    promoCodeDto: CreatePromoCodeDto,
  ): Promise<StandardResponse> {
    const ambassador = await this.userService.findById(
      promoCodeDto.ambassadorId,
    );
    if (!ambassador) {
      throw new NotFoundException(
        new StandardResponse(true, 'AMBASSADOR_NOT_FOUND'),
      );
    }
    const codeValue = await this.generateUniqueCode();
    const promo = this.promoCodeRepo.create({
      ambassadorId: promoCodeDto.ambassadorId,
      ambassadorsReward: promoCodeDto.ambassadorsReward,
      consumersReward: promoCodeDto.consumersReward,
      codeValue,
    });
    const saved = await this.promoCodeRepo.save(promo);
    const dto = PromoCodeMapper.toResponseDto(saved);
    return new StandardResponse(false, 'PROMO_CODE_CREATED', dto);
  }

  async getPromoCode(id: string): Promise<PromoCodeResponseDto> {
    const promo = await this.findByIdOrCodeValue(id);
    const consumersCount = await this.promoCodeRepo
      .createQueryBuilder('promo')
      .leftJoin('promo.consumers', 'consumer')
      .where('promo.id = :id', { id: promo.id })
      .getCount();
    return PromoCodeMapper.toResponseDto(promo, consumersCount);
  }

  async updatePromoCode(
    id: string,
    updatePromoCodeDto: UpdatePromoCodeDto,
  ): Promise<StandardResponse> {
    const promo = await this.findByIdOrCodeValue(id);
    promo.isDisabled = updatePromoCodeDto.isDisabled;
    promo.ambassadorsReward = updatePromoCodeDto.ambassadorsReward;
    promo.consumersReward = updatePromoCodeDto.consumersReward;
    promo.codeValue = promo.codeValue ?? (await this.generateUniqueCode());
    Object.assign(promo, updatePromoCodeDto);
    const updated = await this.promoCodeRepo.save(promo);
    const dto = PromoCodeMapper.toResponseDto(updated);
    return new StandardResponse(false, 'PROMO_CODE_UPDATED', dto);
  }

  async deletePromoCode(id: string): Promise<StandardResponse> {
    const result = await this.promoCodeRepo.delete(id);
    if (!result.affected) {
      throw new NotFoundException(
        new StandardResponse(true, 'PROMO_CODE_NOT_FOUND'),
      );
    }
    return new StandardResponse(false, 'PROMO_CODE_DELETED');
  }

  async validatePromoCode(promoCodeValue: string, consumerId: string) {
    const promoCode = await this.promoCodeRepo.findOne({
      where: { codeValue: promoCodeValue },
    });

    if (!promoCode) {
      throw new NotFoundException(
        new StandardResponse(true, 'PROMO_CODE_NOT_FOUND'),
      );
    } else if (promoCode.ambassadorId == consumerId) {
      throw new BadRequestException(
        new StandardResponse(true, 'PROMO_CODE_CAN_NOT_BE_USED_BY_AMBASSADOR'),
      );
    } else if (promoCode.isDisabled) {
      throw new BadRequestException(
        new StandardResponse(true, 'PROMO_CODE_IS_DISABLED'),
      );
    }

    const consumerUsed = await this.promoCodeRepo
      .createQueryBuilder('promo')
      .innerJoin('promo.consumers', 'consumer', 'consumer.id = :consumerId', {
        consumerId,
      })
      .where('promo.id = :promoCodeId', { promoCodeId: promoCode.id })
      .getExists();

    if (consumerUsed) {
      throw new BadRequestException(
        new StandardResponse(true, 'PROMO_CODE_CAN_ONLY_BE_USED_ONCE_PER_USER'),
      );
    }

    return promoCode;
  }

  async consumePromoCode(promoCodeValue: string, user: Users) {
    const promoCode = await this.promoCodeRepo.findOne({
      where: { codeValue: promoCodeValue },
    });
    if (!promoCode) {
      throw new NotFoundException(
        new StandardResponse(true, 'PROMO_CODE_NOT_FOUND'),
      );
    }

    await this.promoCodeRepo
      .createQueryBuilder()
      .relation(PromoCodes, 'consumers')
      .of(promoCode) // or promoCode.id
      .add(user.id);
    await this.promoCodeRepo.save(promoCode);
  }

  async getPromoCodes(paginationRequest: PaginationRequest) {
    const {
      page = 1,
      size = 10,
      sortBy = 'updatedAt',
      sortOrder = 'DESC',
      search,
    } = paginationRequest;
    const skip = (page - 1) * size;

    const query = this.promoCodeRepo
      .createQueryBuilder('promo')
      .leftJoinAndSelect('promo.ambassador', 'ambassador')
      .addSelect(
        (subQuery) =>
          subQuery
            .select('COUNT(pc_consumer."consumerId")', 'count')
            .from('promo_code_consumers', 'pc_consumer')
            .where('pc_consumer."promoCodeId" = promo.id'),
        'consumersCount',
      )
      .orderBy(`promo.${sortBy}`, sortOrder)
      .skip(skip)
      .take(size);

    if (search) {
      query.andWhere('promo.codeValue ILIKE :search', {
        search: `%${search}%`,
      });
    }

    const rawAndEntities = await query.getRawAndEntities();
    const raw = rawAndEntities.raw;
    const promos = rawAndEntities.entities;

    const data = promos.map((promo, idx) => {
      const consumersCount = parseInt(raw[idx]['consumersCount']) || 0;
      return PromoCodeMapper.toResponseDto(promo, consumersCount);
    });

    // Get total count:
    const total = await query.getCount();

    return StandardResponse.withPagination(
      'PROMO_CODES_FETCHED',
      data,
      paginationRequest,
      total,
    );
  }

  private async findByIdOrCodeValue(id: string) {
    const promo = await this.promoCodeRepo.findOne({
      where: [{ id }, { codeValue: id }],
      relations: ['ambassador'],
    });
    if (!promo) {
      throw new NotFoundException(
        new StandardResponse(true, 'PROMO_CODE_NOT_FOUND'),
      );
    }

    return promo;
  }

  private async generateUniqueCode(
    length = this.PROMO_CODE_LENGTH,
  ): Promise<string> {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code: string;
    let exists = true;
    do {
      code = Array.from(
        { length },
        () => chars[Math.floor(Math.random() * chars.length)],
      ).join('');
      exists = await this.promoCodeRepo.exists({
        where: { codeValue: code },
      });
    } while (exists);
    return code;
  }
  async createCoupon(dto: CreateCouponDto, adminId?: string) {
    const normalizedCode = dto.code.trim().toUpperCase();
    if (dto.type === 'PERCENT' && dto.value > 100) {
      throw new BadRequestException('COUPON_PERCENTAGE_CANNOT_EXCEED_100');
    }

    const startDate = this.parseCouponDate(dto.startDate, false);
    const endDate = this.parseCouponDate(dto.endDate, true);
    if (startDate && endDate && endDate <= startDate) {
      throw new BadRequestException('COUPON_END_DATE_MUST_FOLLOW_START_DATE');
    }

    const existing = await this.couponRepo.findOne({
      where: { code: normalizedCode },
    });
    if (existing) throw new BadRequestException('COUPON_CODE_EXISTS');

    const coupon = this.couponRepo.create({
      code: normalizedCode,
      type: dto.type,
      value: dto.value,
      appliesTo: dto.appliesTo?.trim() || 'SITE',
      startDate,
      endDate,
      usageLimit: dto.usageLimit ?? null,
      createdBy: adminId ? ({ id: adminId } as any) : null,
    });

    try {
      return await this.couponRepo.save(coupon);
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new BadRequestException('COUPON_CODE_EXISTS');
      }
      throw error;
    }
  }

  async deactivateCoupon(id: string) {
    const c = await this.couponRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('COUPON_NOT_FOUND');
    c.status = CouponStatus.INACTIVE;
    return this.couponRepo.save(c);
  }

  async deleteCoupon(id: string) {
    const coupon = await this.couponRepo.findOne({ where: { id } });
    if (!coupon) throw new NotFoundException('COUPON_NOT_FOUND');
    if (coupon.source === CouponSource.BIRTHDAY) {
      throw new BadRequestException('SYSTEM_COUPON_CANNOT_BE_DELETED');
    }

    const result = await this.couponRepo.delete(id);
    if (!result.affected) throw new NotFoundException('COUPON_NOT_FOUND');
    return new StandardResponse(false, 'COUPON_DELETED');
  }

  async validateCoupon(code: string, storeId?: string, userId?: string) {
    const coupon = await this.couponRepo.findOne({
      where: { code: code.trim().toUpperCase() },
    });
    if (!coupon) throw new NotFoundException('COUPON_NOT_FOUND');
    this.assertCouponCanBeUsed(coupon, storeId, userId);
    return coupon;
  }

  async recordCouponUse(
    code: string,
    userId: string,
    orderId: string,
    storeId?: string,
  ) {
    return this.couponRepo.manager.transaction(async (manager) => {
      return this.recordCouponUseWithManager(
        manager,
        code,
        userId,
        orderId,
        storeId,
      );
    });
  }

  async saveOrderWithCouponUse(
    order: Orders,
    code: string,
    userId: string,
    storeId?: string,
  ) {
    return this.couponRepo.manager.transaction(async (manager) => {
      const savedOrder = await manager.getRepository(Orders).save(order);
      await this.recordCouponUseWithManager(
        manager,
        code,
        userId,
        savedOrder.id,
        storeId,
      );
      return savedOrder;
    });
  }

  async getAllCoupon() {
    const coupons = await this.couponRepo.find({
      where: { source: CouponSource.ADMIN },
      order: { createdAt: 'DESC' },
    });
    const data = coupons.map((coupon) => ({
      ...coupon,
      usedCount: Number(coupon.timesUsed || 0),
      isActive:
        coupon.status === CouponStatus.ACTIVE &&
        (!coupon.endDate || coupon.endDate >= new Date()),
    }));
    return new StandardResponse(false, 'COUPON_FETCHED', data);
  }

  async getBirthdayRewardAnalytics({
    page = 1,
    size = 25,
    search,
    usage,
  }: {
    page?: number;
    size?: number;
    search?: string;
    usage?: 'used' | 'unused';
  }) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.min(100, Math.max(1, Number(size) || 25));

    const ageRows = await this.usersRepo
      .createQueryBuilder('user')
      .select(
        `CASE
          WHEN DATE_PART('year', AGE((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date, user.dateOfBirth)) < 18 THEN 'under18'
          WHEN DATE_PART('year', AGE((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date, user.dateOfBirth)) BETWEEN 18 AND 24 THEN '18to24'
          WHEN DATE_PART('year', AGE((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date, user.dateOfBirth)) BETWEEN 25 AND 34 THEN '25to34'
          WHEN DATE_PART('year', AGE((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date, user.dateOfBirth)) BETWEEN 35 AND 44 THEN '35to44'
          WHEN DATE_PART('year', AGE((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date, user.dateOfBirth)) BETWEEN 45 AND 54 THEN '45to54'
          ELSE '55plus'
        END`,
        'range',
      )
      .addSelect('COUNT(user.id)', 'count')
      .where('user.userRole = :role', { role: UserRoles.CUSTOMER })
      .andWhere('user.dateOfBirth IS NOT NULL')
      .groupBy('range')
      .getRawMany<{ range: string; count: string }>();

    const ageRanges = {
      under18: 0,
      '18to24': 0,
      '25to34': 0,
      '35to44': 0,
      '45to54': 0,
      '55plus': 0,
    };
    ageRows.forEach((row) => {
      if (row.range in ageRanges) {
        ageRanges[row.range] = Number(row.count) || 0;
      }
    });

    const rewardQuery = this.couponRepo
      .createQueryBuilder('coupon')
      .leftJoinAndSelect('coupon.audienceUser', 'user')
      .leftJoinAndSelect('coupon.redemptions', 'redemption')
      .where('coupon.source = :source', { source: CouponSource.BIRTHDAY })
      .orderBy('coupon.createdAt', 'DESC');

    if (usage === 'used') {
      rewardQuery.andWhere('coupon.timesUsed > 0');
    } else if (usage === 'unused') {
      rewardQuery.andWhere('coupon.timesUsed = 0');
    }
    if (search?.trim()) {
      rewardQuery.andWhere(
        `(coupon.code ILIKE :search
          OR user.firstName ILIKE :search
          OR user.lastName ILIKE :search
          OR user.email ILIKE :search)`,
        { search: `%${search.trim()}%` },
      );
    }

    const [rewards, filteredTotal] = await rewardQuery
      .skip((safePage - 1) * safeSize)
      .take(safeSize)
      .getManyAndCount();

    const [issued, used, usersWithBirthday] = await Promise.all([
      this.couponRepo.count({
        where: { source: CouponSource.BIRTHDAY },
      }),
      this.couponRepo
        .createQueryBuilder('coupon')
        .where('coupon.source = :source', {
          source: CouponSource.BIRTHDAY,
        })
        .andWhere('coupon.timesUsed > 0')
        .getCount(),
      this.usersRepo
        .createQueryBuilder('user')
        .where('user.userRole = :role', { role: UserRoles.CUSTOMER })
        .andWhere('user.dateOfBirth IS NOT NULL')
        .getCount(),
    ]);

    return new StandardResponse(false, 'BIRTHDAY_REWARD_ANALYTICS_FETCHED', {
      usersWithBirthday,
      ageRanges,
      rewards: {
        issued,
        used,
        unused: Math.max(0, issued - used),
        usageRate: issued ? Number(((used / issued) * 100).toFixed(1)) : 0,
      },
      recipients: rewards.map((coupon) => ({
        couponId: coupon.id,
        code: coupon.code,
        userId: coupon.audienceUserId,
        firstName: coupon.audienceUser?.firstName,
        lastName: coupon.audienceUser?.lastName,
        email: coupon.audienceUser?.email,
        issuedAt: coupon.createdAt,
        expiresAt: coupon.endDate,
        used: Number(coupon.timesUsed || 0) > 0,
        usedAt: coupon.redemptions?.[0]?.redeemedAt ?? null,
        orderId: coupon.redemptions?.[0]?.orderId ?? null,
      })),
      pagination: {
        page: safePage,
        size: safeSize,
        total: filteredTotal,
        totalPages: Math.ceil(filteredTotal / safeSize),
      },
    });
  }

  private assertCouponCanBeUsed(
    coupon: Coupon,
    storeId?: string,
    userId?: string,
  ) {
    if (coupon.status !== CouponStatus.ACTIVE) {
      throw new BadRequestException('COUPON_INACTIVE');
    }
    const now = new Date();
    if (coupon.startDate && now < coupon.startDate) {
      throw new BadRequestException('COUPON_NOT_STARTED');
    }
    if (coupon.endDate && now > coupon.endDate) {
      throw new BadRequestException('COUPON_EXPIRED');
    }
    if (coupon.usageLimit && coupon.timesUsed >= coupon.usageLimit) {
      throw new BadRequestException('COUPON_USAGE_LIMIT_REACHED');
    }
    if (coupon.appliesTo !== 'SITE' && coupon.appliesTo !== storeId) {
      throw new BadRequestException('COUPON_NOT_APPLICABLE_FOR_STORE');
    }
    if (coupon.audienceUserId && coupon.audienceUserId !== userId) {
      throw new BadRequestException('COUPON_NOT_ASSIGNED_TO_USER');
    }
  }

  private async recordCouponUseWithManager(
    manager: EntityManager,
    code: string,
    userId: string,
    orderId: string,
    storeId?: string,
  ) {
    const couponRepository = manager.getRepository(Coupon);
    const coupon = await couponRepository
      .createQueryBuilder('coupon')
      .setLock('pessimistic_write')
      .where('UPPER(coupon.code) = :code', {
        code: code.trim().toUpperCase(),
      })
      .getOne();
    if (!coupon) throw new NotFoundException('COUPON_NOT_FOUND');

    const redemptionRepository = manager.getRepository(CouponRedemption);
    const existing = await redemptionRepository.findOne({
      where: { couponId: coupon.id, orderId },
    });
    if (existing) return existing;

    this.assertCouponCanBeUsed(coupon, storeId, userId);

    const redemption = redemptionRepository.create({
      couponId: coupon.id,
      userId,
      orderId,
    });
    const saved = await redemptionRepository.save(redemption);

    coupon.timesUsed = Number(coupon.timesUsed || 0) + 1;
    if (coupon.usageLimit && coupon.timesUsed >= coupon.usageLimit) {
      coupon.status = CouponStatus.INACTIVE;
    }
    await couponRepository.save(coupon);
    return saved;
  }

  private parseCouponDate(value?: string, endOfDay = false) {
    if (!value) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const parsed = new Date(
      dateOnly
        ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+01:00`
        : value,
    );
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('INVALID_COUPON_DATE');
    }
    return parsed;
  }
}

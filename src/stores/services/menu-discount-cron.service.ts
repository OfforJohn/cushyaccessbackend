// src/menu/services/menu-discount-cron.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MenuItem } from '../model/menu-item.entity';

@Injectable()
export class MenuDiscountCronService {
  private readonly logger = new Logger(MenuDiscountCronService.name);

  constructor(
    @InjectRepository(MenuItem)
    private readonly menuItemRepository: Repository<MenuItem>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async disableExpiredDiscounts() {
    const now = new Date();

    const result = await this.menuItemRepository.update(
      { discountEnd: LessThan(now), isDiscountActive: true },
      {
        isDiscountActive: false,
        discountPercentage: null,
        discountPrice: null,
        discountStart: null,
        discountEnd: null,
      },
    );

    this.logger.log(`Disabled ${result.affected} expired discount(s) at ${now.toISOString()}`);
  }
}
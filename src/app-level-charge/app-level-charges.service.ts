import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AppLevelCharges } from 'src/orders/model/app-level/app-level-charges.entity';
import { Repository } from 'typeorm';

@Injectable()
export class AppLevelChargesService implements OnModuleInit {
  constructor(
    @InjectRepository(AppLevelCharges)
    private readonly repo: Repository<AppLevelCharges>,
  ) {}

  async onModuleInit() {
    const defaultId = 'sc_cushy_access';

    // check if record already exists
    const existing = await this.repo.findOne({ where: { id: defaultId } });

    if (!existing) {
      const defaultCharges = this.repo.create({
        id: defaultId,
        deliveryFeePerKmForBike: 200,
        deliveryFeePerKmForVan: 600,
      });
      await this.repo.save(defaultCharges);
      console.log('✅ Default AppLevelCharges record created');
    } else {
      console.log('ℹ️ Default AppLevelCharges record already exists');
    }
  }
}

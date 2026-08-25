import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppLevelChargesService } from './app-level-charges.service';
import { AppLevelCharges } from 'src/orders/model/app-level/app-level-charges.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AppLevelCharges])],
  providers: [AppLevelChargesService],
  exports: [AppLevelChargesService],
})
export class AppLevelChargesModule {}

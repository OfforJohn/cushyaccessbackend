import { Module } from '@nestjs/common';
import { AdvertisementService } from './advertisement.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Advertisements } from './model/advertisement.entity';
import { AdvertisementController } from './advertisement.controller';
import { RedisCacheModule } from '../redis-cache/redis-cache.module';
import { S3Service } from 'src/utils/s3-bucket.service';

@Module({
  providers: [AdvertisementService, S3Service],
  imports: [TypeOrmModule.forFeature([Advertisements]), RedisCacheModule],
  controllers: [AdvertisementController],
})
export class AdvertisementModule {}

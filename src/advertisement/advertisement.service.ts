import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdvertisementCategory } from './model/advertisement-category.enum';
import { Advertisements } from './model/advertisement.entity';
import { CreateAdvertisementsDto } from './model/create-advertisement.dto';
import { StandardResponse } from 'src/common/module/standard-response';
import { RedisCacheService } from '../redis-cache/redis-cache.service';
import { S3Service } from 'src/utils/s3-bucket.service';

@Injectable()
export class AdvertisementService {
  constructor(
    @InjectRepository(Advertisements)
    private readonly advertisementRepository: Repository<Advertisements>,
    private readonly redisCacheService: RedisCacheService,
    private readonly s3Service: S3Service,
  ) { }

  async createAdvertisement(
    createAdvertisementsDto: CreateAdvertisementsDto,
  ): Promise<StandardResponse> {
    const { category, callToAction, url } = createAdvertisementsDto;
    const adCacheKey = `advertisement:${category?.toLowerCase()}`;

    const adCount = await this.advertisementRepository.count({
      where: { category },
    });
    if (adCount >= 12) {
      throw new BadRequestException(
        new StandardResponse(true, 'ADS_EXCEEDED_CATEGORY_LIMIT'),
      );
    }

    const advertisement = this.advertisementRepository.create({
      category,
      callToAction,
      url,
    });

    const savedAd = await this.advertisementRepository.save(advertisement);
    await this.redisCacheService.deleteCachedItem(adCacheKey);

    return new StandardResponse(
      false,
      'ADVERTISEMENT_CREATED_SUCCESSFULLY',
      savedAd,
    );
  }

  async getAdvertisements(
    category: AdvertisementCategory,
  ): Promise<StandardResponse> {
    const adCacheKey = `advertisement:${category?.toLowerCase()}`;

    const advertisement =
      await this.redisCacheService.getCachedItem(adCacheKey);

    if (advertisement) {
      return new StandardResponse(
        false,
        'ADVERTISEMENT_FETCHED_SUCCESSFULLY',
        advertisement as Advertisements,
      );
    }
    const ads = await this.advertisementRepository.find({
      where: { category },
    });

    await this.redisCacheService.setItemInCache(adCacheKey, ads);
    return new StandardResponse(
      false,
      'ADVERTISEMENT_FETCHED_SUCCESSFULLY',
      ads,
    );
  }

  async deleteAdvertisement(id: string): Promise<StandardResponse> {
    const advertisement = await this.advertisementRepository.findOne({
      where: {
        id,
      },
    });

    if (!advertisement) {
      throw new NotFoundException(
        new StandardResponse(true, `ADVERTISEMENT_NOT_FOUND`),
      );
    }
    const adCacheKey = `advertisement:${advertisement?.category?.toLowerCase()}`;

    // Delete the banner image from S3
    if (advertisement.url) {
      await this.s3Service.deleteFileByUrl(advertisement.url);
    }

    await this.advertisementRepository.delete(id);

    await this.redisCacheService.deleteCachedItem(adCacheKey);
    return new StandardResponse(false, 'ADVERTISEMENT_DELETED_SUCCESSFULLY');
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommonService } from '../../common/common.service';
import { StandardResponse } from '../../common/module/standard-response';
import { UserCredentialStatus } from '../../users/model/user-credential.enum';
import { FavoriteStore } from '../model/favorite-store.entity';
import { Stores } from '../model/stores.entity';
import { StoreMapper } from './stores.mapper';
import { StoreService } from './stores.service';

@Injectable()
export class FavoriteStoreService {
  constructor(
    @InjectRepository(FavoriteStore)
    private readonly favoriteRepository: Repository<FavoriteStore>,
    @InjectRepository(Stores)
    private readonly storeRepository: Repository<Stores>,
    private readonly commonService: CommonService,
    private readonly storeService: StoreService,
  ) {}

  async add(storeId: string) {
    const user = await this.commonService.getLoggedInUser();
    const store = await this.storeRepository
      .createQueryBuilder('store')
      .innerJoin('store.user', 'vendor')
      .where('store.id = :storeId', { storeId })
      .andWhere('store.isVisible = true')
      .andWhere('store.isSuspended = false')
      .andWhere('vendor.verificationStatus = :verificationStatus', {
        verificationStatus: UserCredentialStatus.APPROVED,
      })
      .getOne();
    if (!store) throw new NotFoundException('STORE_NOT_FOUND');

    await this.favoriteRepository
      .createQueryBuilder()
      .insert()
      .into(FavoriteStore)
      .values({ userId: user.id, storeId })
      .orIgnore()
      .execute();

    return new StandardResponse(false, 'STORE_ADDED_TO_FAVORITES', {
      storeId,
      isFavorite: true,
    });
  }

  async remove(storeId: string) {
    const user = await this.commonService.getLoggedInUser();
    await this.favoriteRepository.delete({ userId: user.id, storeId });
    return new StandardResponse(false, 'STORE_REMOVED_FROM_FAVORITES', {
      storeId,
      isFavorite: false,
    });
  }

  async status(storeId: string) {
    const user = await this.commonService.getLoggedInUser();
    const isFavorite = await this.favoriteRepository.existsBy({
      userId: user.id,
      storeId,
    });
    return new StandardResponse(false, 'FAVORITE_STATUS_FETCHED', {
      storeId,
      isFavorite,
    });
  }

  async list() {
    const user = await this.commonService.getLoggedInUser();
    const favorites = await this.favoriteRepository
      .createQueryBuilder('favorite')
      .innerJoinAndSelect('favorite.store', 'store')
      .innerJoin('store.user', 'vendor')
      .leftJoinAndSelect('store.address', 'address')
      .where('favorite.userId = :userId', { userId: user.id })
      .andWhere('store.isVisible = true')
      .andWhere('store.isSuspended = false')
      .andWhere('vendor.verificationStatus = :verificationStatus', {
        verificationStatus: UserCredentialStatus.APPROVED,
      })
      .orderBy('favorite.createdAt', 'DESC')
      .getMany();
    const stores = await this.storeService.attachOpeningSchedules(
      favorites.map(({ store }) => store),
    );

    return new StandardResponse(
      false,
      'FAVORITES_FETCHED',
      new StoreMapper().mapStoresToStoreList(stores),
    );
  }
}

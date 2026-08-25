import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { StoreService } from './stores.service';
import { StoreMapper } from './stores.mapper';
import { MenuPack } from '../model/menu-pack.entity';
import { MenuPackRequest } from '../model/dtos/menu-pack.request';

@Injectable()
export class MenuPackService {
  constructor(
    @InjectRepository(MenuPack)
    private readonly menuPackRepository: Repository<MenuPack>,
    private readonly commonService: CommonService,
    private readonly storeService: StoreService,
  ) {}

  async createMenuPack(
    storeId: string,
    menuPackDto: MenuPackRequest,
  ): Promise<StandardResponse> {
    const newMenuPack = new MenuPack();
    const authenticatedUser = await this.commonService.getLoggedInUser();

    const isExisting = await this.storeService.existingByStoreIdAndVendorId(
      storeId,
      authenticatedUser.id,
    );

    if (!isExisting) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }

    const isNameExists = await this.menuPackRepository.findOne({
      where: { name: menuPackDto.name },
    });

    if (isNameExists) {
      throw new BadRequestException(
        new StandardResponse(true, 'MENU_PACK_NAME_ALREADY_EXISTS'),
      );
    }

    newMenuPack.name = menuPackDto.name;
    newMenuPack.isPublished = menuPackDto.isPublished;
    newMenuPack.storeId = storeId;
    newMenuPack.userId = authenticatedUser.id;
    await this.menuPackRepository.save(newMenuPack);

    return new StandardResponse(
      false,
      'MENU_PACK_CREATED_SUCCESSFULLY',
      new StoreMapper().mapMenuPack(newMenuPack),
    );
  }

  async updateMenuPack(
    id: string,
    menuPackDto: MenuPackRequest,
  ): Promise<StandardResponse> {
    const menuPack = await this.menuPackRepository.findOne({
      where: { id },
    });

    if (!menuPack) {
      throw new NotFoundException(
        new StandardResponse(true, 'MENU_PACK_NOT_FOUND'),
      );
    }

    menuPack.name = menuPackDto.name;
    menuPack.isPublished = menuPackDto.isPublished;

    await this.menuPackRepository.save(menuPack);

    return new StandardResponse(
      false,
      'MENU_PACK_UPDATED_SUCCESSFULLY',
      new StoreMapper().mapMenuPack(menuPack),
    );
  }

  async deleteMenuPack(id: string): Promise<StandardResponse> {
    const menuPack = await this.menuPackRepository.findOne({
      where: { id },
    });

    if (!menuPack) {
      throw new NotFoundException(
        new StandardResponse(true, 'MENU_PACK_NOT_FOUND'),
      );
    }

    await this.menuPackRepository.remove(menuPack);

    return new StandardResponse(false, 'MENU_PACK_DELETED_SUCCESSFULLY');
  }

  async getMenuPacks(storeId: string): Promise<StandardResponse> {
    const menuPacks = await this.menuPackRepository.find({
      where: { storeId },
    });

    return new StandardResponse(
      false,
      'MENU_PACKS_FETCHED_SUCCESSFULLY',
      new StoreMapper().mapMenuPackList(menuPacks),
    );
  }

  async existingByStoreIdAndVendorId(
    storeId: string,
    vendorId: string,
  ): Promise<boolean> {
    return await this.menuPackRepository.exist({
      where: { storeId, userId: vendorId },
    });
  }
}

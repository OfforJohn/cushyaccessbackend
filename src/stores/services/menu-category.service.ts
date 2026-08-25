import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Raw, Repository } from 'typeorm';
import { MenuCategoryRequest } from '../model/dtos/menu-category.request';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { StoreService } from './stores.service';
import { StoreMapper } from './stores.mapper';
import { MenuCategory } from '../model/menu-category.entity';

@Injectable()
export class MenuCategoryService {
  constructor(
    @InjectRepository(MenuCategory)
    private readonly menuCategoryRepository: Repository<MenuCategory>,
    private readonly commonService: CommonService,
    private readonly storeService: StoreService,
  ) {}

  async createMenuCategory(
    storeId: string,
    menuCategoryDto: MenuCategoryRequest,
  ): Promise<StandardResponse> {
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

    const normalizedName = this.normalizeName(menuCategoryDto.name);
    await this.assertNameAvailable(storeId, normalizedName);
    const newMenuCategory = this.menuCategoryRepository.create({
      name: menuCategoryDto.name.trim(),
      normalizedName,
      isPublished: menuCategoryDto.isPublished,
      storeId,
      userId: authenticatedUser.id,
    });

    try {
      await this.menuCategoryRepository.save(newMenuCategory);
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new BadRequestException(
          new StandardResponse(true, 'MENU_CATEGORY_NAME_ALREADY_EXISTS'),
        );
      }
      throw error;
    }

    return new StandardResponse(
      false,
      'MENU_CATEGORY_CREATED_SUCCESSFULLY',
      new StoreMapper().mapMenuCategory(newMenuCategory),
    );
  }

  async updateMenuCategory(
    id: string,
    menuCategoryDto: MenuCategoryRequest,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const menuCategory = await this.menuCategoryRepository.findOne({
      where: { id, userId: authenticatedUser.id },
    });
    if (!menuCategory) {
      throw new NotFoundException(
        new StandardResponse(true, 'MENU_CATEGORY_NOT_FOUND'),
      );
    }

    const normalizedName = this.normalizeName(menuCategoryDto.name);
    await this.assertNameAvailable(menuCategory.storeId, normalizedName, id);
    menuCategory.name = menuCategoryDto.name.trim();
    menuCategory.normalizedName = normalizedName;
    menuCategory.isPublished = menuCategoryDto.isPublished;

    try {
      await this.menuCategoryRepository.save(menuCategory);
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new BadRequestException(
          new StandardResponse(true, 'MENU_CATEGORY_NAME_ALREADY_EXISTS'),
        );
      }
      throw error;
    }

    return new StandardResponse(
      false,
      'MENU_CATEGORY_UPDATED_SUCCESSFULLY',
      new StoreMapper().mapMenuCategory(menuCategory),
    );
  }

  async deleteMenuCategory(id: string): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const menuCategory = await this.menuCategoryRepository.findOne({
      where: { id, userId: authenticatedUser.id },
    });

    if (!menuCategory) {
      throw new NotFoundException(
        new StandardResponse(true, 'MENU_CATEGORY_NOT_FOUND'),
      );
    }

    await this.menuCategoryRepository.remove(menuCategory);

    return new StandardResponse(false, 'MENU_CATEGORY_DELETED_SUCCESSFULLY');
  }

  async getMenuCategories(storeId: string): Promise<StandardResponse> {
    const menuCategories = await this.menuCategoryRepository.find({
      where: { storeId },
    });

    return new StandardResponse(
      false,
      'MENU_CATEGORIES_FETCHED_SUCCESSFULLY',
      new StoreMapper().mapMenuCategoryList(menuCategories),
    );
  }

  async existingByIdStoreAndVendorId(
    id: string,
    storeId: string,
    vendorId: string,
  ): Promise<boolean> {
    return this.menuCategoryRepository.exist({
      where: { id, storeId, userId: vendorId },
    });
  }

  private normalizeName(name: string) {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) {
      throw new BadRequestException(
        new StandardResponse(true, 'MENU_CATEGORY_NAME_REQUIRED'),
      );
    }
    return normalizedName;
  }

  private normalizedNameCondition(normalizedName: string) {
    return Raw((alias) => `LOWER(TRIM(${alias})) = :normalizedName`, {
      normalizedName,
    });
  }

  private async assertNameAvailable(
    storeId: string,
    normalizedName: string,
    excludedId?: string,
  ) {
    const duplicate = await this.menuCategoryRepository.findOne({
      where: {
        storeId,
        ...(excludedId ? { id: Not(excludedId) } : {}),
        name: this.normalizedNameCondition(normalizedName),
      },
    });
    if (duplicate) {
      throw new BadRequestException(
        new StandardResponse(true, 'MENU_CATEGORY_NAME_ALREADY_EXISTS'),
      );
    }
  }
}

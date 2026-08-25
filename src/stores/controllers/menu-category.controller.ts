import {
  Controller,
  Post,
  Put,
  Delete,
  Get,
  Param,
  Body,
} from '@nestjs/common';
import { StandardResponse } from '../../common/module/standard-response';
import { MenuCategoryRequest } from '../model/dtos/menu-category.request';
import { MenuCategoryService } from '../services/menu-category.service';

@Controller('api/v1/menu-categories')
export class MenuCategoryController {
  constructor(private readonly menuCategoryService: MenuCategoryService) {}

  @Post(':storeId')
  async createMenuCategory(
    @Param('storeId') storeId: string,
    @Body() menuCategoryDto: MenuCategoryRequest,
  ): Promise<StandardResponse> {
    return this.menuCategoryService.createMenuCategory(
      storeId,
      menuCategoryDto,
    );
  }

  @Put(':id')
  async updateMenuCategory(
    @Param('id') id: string,
    @Body() menuCategoryDto: MenuCategoryRequest,
  ): Promise<StandardResponse> {
    return this.menuCategoryService.updateMenuCategory(id, menuCategoryDto);
  }

  @Delete(':id')
  async deleteMenuCategory(@Param('id') id: string): Promise<StandardResponse> {
    return this.menuCategoryService.deleteMenuCategory(id);
  }

  @Get(':storeId')
  async getMenuCategories(
    @Param('storeId') storeId: string,
  ): Promise<StandardResponse> {
    return this.menuCategoryService.getMenuCategories(storeId);
  }
}

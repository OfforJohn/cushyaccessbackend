import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { MenuItemService } from '../services/menu-item.service';
import { StandardResponse } from '../../common/module/standard-response';
import { MenuItemRequest } from '../model/dtos/menu-item.request';
import { PaginationRequest } from '../../common/module/pagination-request';
import { MenuAvailabilityRequest } from '../model/dtos/menu-avialability.request';
import { Public } from '../../auth/service/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';
import { StoreCategory } from '../model/enums/store.category';

@Controller('api/v1/menu-items')
export class MenuItemController {
  constructor(private readonly menuItemService: MenuItemService) {}

  @Post(':storeId')
  async createMenuItem(
    @Param('storeId') storeId: string,
    @Body() menuItemDto: MenuItemRequest,
  ): Promise<StandardResponse> {
    return await this.menuItemService.createMenuItem(storeId, menuItemDto);
  }

  @Put(':storeId/:menuId')
  async updateMenuItem(
    @Param('storeId') storeId: string,
    @Param('menuId') menuId: string,
    @Body() menuItemDto: MenuItemRequest,
  ): Promise<StandardResponse> {
    return await this.menuItemService.updateMenuItem(
      storeId,
      menuId,
      menuItemDto,
    );
  }

  @Public()
  @Get('search/discovery')
  async searchDiscovery(
    @Query('query') query: string,
    @Query('category') category?: StoreCategory,
    @Headers('cushy-access-key') accessKey?: string,
  ): Promise<StandardResponse> {
    return this.menuItemService.searchDiscovery(query, category, accessKey);
  }

  @Public()
  @SkipThrottle()
  @Get('ai-stores-items')
  async getStoresWithItems(@Query('query') query: string) {
    const storeWithItems = await this.menuItemService.getMenuItemsAI(query);
    return new StandardResponse(
      false,
      'STORES_WITH_ITEMS_FETCHED_SUCCESSFULLY',
      {
        stores: storeWithItems,
      },
    );
  }

  @Public()
  @Get(':storeId')
  async getMenuItems(
    @Param('storeId') storeId: string,
    @Query() paginationRequest?: PaginationRequest,
  ): Promise<StandardResponse> {
    return await this.menuItemService.getMenuItems(storeId, paginationRequest);
  }

  @Public()
  @Get(':storeId/:menuId')
  async getMenuItem(
    @Param('storeId') storeId: string,
    @Param('menuId') menuId: string,
  ): Promise<StandardResponse> {
    return await this.menuItemService.getMenuItem(storeId, menuId);
  }

  @Patch(':storeId/:menuId/availability')
  async updateMenuItemAvailability(
    @Param('storeId') storeId: string,
    @Param('menuId') menuId: string,
    @Body() menuAvailabilityRequest: MenuAvailabilityRequest,
  ): Promise<StandardResponse> {
    return await this.menuItemService.updateMenuItemAvailability(
      storeId,
      menuId,
      menuAvailabilityRequest.isAvailable,
    );
  }

  @Delete(':storeId/:menuId')
  async deleteMenuItem(
    @Param('storeId') storeId: string,
    @Param('menuId') menuId: string,
  ): Promise<StandardResponse> {
    return await this.menuItemService.deleteMenuItem(storeId, menuId);
  }

  @Patch(':id/out-of-stock')
  async setOutOfStock(@Param('id') id: string) {
    return await this.menuItemService.markAsOutOfStock(id);
  }
  @Patch(':id/in-stock')
  async setInStock(@Param('id') id: string) {
    return await this.menuItemService.markAsInStock(id);
  }
}

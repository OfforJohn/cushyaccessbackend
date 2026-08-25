import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { MenuPackService } from '../services/menu-pack.service';
import { StandardResponse } from '../../common/module/standard-response';
import { MenuPackRequest } from '../model/dtos/menu-pack.request';

@Controller('api/v1/menu-packs')
export class MenuPackController {
  constructor(private readonly menuPackService: MenuPackService) {}

  @Post(':storeId')
  async createMenuPack(
    @Param('storeId') storeId: string,
    @Body() menuPackDto: MenuPackRequest,
  ): Promise<StandardResponse> {
    return await this.menuPackService.createMenuPack(storeId, menuPackDto);
  }

  @Put(':id')
  async updateMenuPack(
    @Param('id') id: string,
    @Body() menuPackDto: MenuPackRequest,
  ): Promise<StandardResponse> {
    return await this.menuPackService.updateMenuPack(id, menuPackDto);
  }

  @Delete(':id')
  async deleteMenuPack(@Param('id') id: string): Promise<StandardResponse> {
    return await this.menuPackService.deleteMenuPack(id);
  }

  @Get(':storeId')
  async getMenuPacks(
    @Param('storeId') storeId: string,
  ): Promise<StandardResponse> {
    return await this.menuPackService.getMenuPacks(storeId);
  }
}

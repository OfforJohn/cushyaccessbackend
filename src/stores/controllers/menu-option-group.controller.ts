import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { StandardResponse } from '../../common/module/standard-response';
import { MenuOptionGroupRequest } from '../model/dtos/menu-option-group.request';
import { MenuOptionGroupService } from '../services/menu-option-group.service';

@Controller('api/v1/menu-option-groups')
export class MenuOptionGroupController {
  constructor(private readonly optionGroupService: MenuOptionGroupService) {}

  @Post(':storeId')
  create(
    @Param('storeId') storeId: string,
    @Body() request: MenuOptionGroupRequest,
  ): Promise<StandardResponse> {
    return this.optionGroupService.create(storeId, request);
  }

  @Get(':storeId')
  list(@Param('storeId') storeId: string): Promise<StandardResponse> {
    return this.optionGroupService.list(storeId);
  }

  @Patch('group/:id')
  update(
    @Param('id') id: string,
    @Body() request: MenuOptionGroupRequest,
  ): Promise<StandardResponse> {
    return this.optionGroupService.update(id, request);
  }

  @Delete('group/:id')
  remove(@Param('id') id: string): Promise<StandardResponse> {
    return this.optionGroupService.remove(id);
  }
}

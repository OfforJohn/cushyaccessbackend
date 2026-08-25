import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { StandardResponse } from '../../common/module/standard-response';
import { Permit } from '../../auth/service/roles.decorator';
import { UserRoles } from '../model/user-roles.enum';
import { VendorCategoryService } from '../services/vendor-category.service';
import { defaultCategories } from 'src/default-categories';
import { Public } from 'src/auth/service/public.decorator';
import { CreateVendorCategoryDto } from '../model/dto/create-vendor-category.dto';
import { UpdateVendorCategoryDto } from '../model/dto/update-vendor-category.dto';

@Controller('api/v1/vendor-category')
export class VendorCategoryController {
    constructor(private readonly vendorCategoryService: VendorCategoryService) {}

    @Permit([UserRoles.ADMIN, UserRoles.VENDOR])
    @Public()
    @Get()
    async getAllCategories(): Promise<StandardResponse> {
        const categories = await this.vendorCategoryService.getAllCategories();
        return new StandardResponse(false, 'VENDOR_CATEGORIES_FETCHED_SUCCESSFULLY', categories);
    }
    @Permit([UserRoles.ADMIN, UserRoles.VENDOR])
    // @Public()
    @Post('create-vendor-category')
    async createVendorCategory(@Body() payload: CreateVendorCategoryDto): Promise<StandardResponse> {
        const exists = await this.vendorCategoryService.findByKey(payload.key);
        if (exists) {
            return new StandardResponse(true, 'VENDOR_CATEGORY_ALREADY_EXISTS', null);
        }
        const category = await this.vendorCategoryService.create(payload);
        return new StandardResponse(false, 'VENDOR_CATEGORY_CREATED_SUCCESSFULLY', category);
    }
    @Permit([UserRoles.ADMIN, UserRoles.VENDOR])
    // @Public()
    @Patch('update-vendor-category/:id')
    async updateVendorCategory(@Param('id') id: string, @Body() payload: UpdateVendorCategoryDto): Promise<StandardResponse> {
        const category = await this.vendorCategoryService.update(id, payload);
        return new StandardResponse(false, 'VENDOR_CATEGORY_UPDATED_SUCCESSFULLY', category);
    }
    @Permit([UserRoles.ADMIN, UserRoles.VENDOR])
    // @Public()
    @Delete('delete-vendor-category/:id')
    async deleteVendorCategory(@Param('id') id: string): Promise<StandardResponse> {
        await this.vendorCategoryService.delete(id);
        return new StandardResponse(false, 'VENDOR_CATEGORY_DELETED_SUCCESSFULLY', null);
    }
}

import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { VendorCategoryService } from './vendor-category.service';
import { defaultCategories } from '../../default-categories';
import { UsersService } from './users.service';

@Injectable()
export class CategoryInitService implements OnApplicationBootstrap {
  constructor(
    private readonly vendorCategoryService: VendorCategoryService,
    private readonly userService: UsersService,
  ) {}

  async onApplicationBootstrap() {
    console.log('registering default admin');
    await this.userService.registerDefaultAppAdmin();
    for (const category of defaultCategories) {
      const exists = await this.vendorCategoryService.findByKey(category.key);
      if (!exists) {
        await this.vendorCategoryService.create(category);
      }
    }
    console.log('Default Vendor categories ensured in DB');
  }
}

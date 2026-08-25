import { MenuCategoryDto } from '../model/dtos/menu-category.dto';
import { StoreList } from '../model/dtos/store-list.dto';
import { MenuCategory } from '../model/menu-category.entity';
import { Stores } from '../model/stores.entity';
import { MenuPackDto } from '../model/dtos/menu-pack.dto';
import { MenuPack } from '../model/menu-pack.entity';
import { MenuItemDto } from '../model/dtos/menu-item.dto';
import { MenuItemListDto } from '../model/dtos/menu-item-list.dto';
import { MenuItem } from '../model/menu-item.entity';

export class StoreMapper {
  mapStoreList(store: Stores): StoreList {
    const storeList = new StoreList();
    storeList.id = store.id;
    storeList.userId = store.userId;
    storeList.name = store.name;
    storeList.coverImage = store.coverImage;
    storeList.location = store?.address?.address || '';
    storeList.reviewCount = 0;
    storeList.rating = 0;
    storeList.estimateDeliveryFee = 0;
    storeList.category = store.category;
    storeList.walletBalance = store?.user?.wallet?.walletBalance || 0;
    storeList.ordersCount =
      (store as any).ordersCount || store?.orders?.length || 0;
    storeList.isVisible = store.isVisible;
    storeList.isFeatured = store.isFeatured;
    storeList.featuredAt = store.featuredAt;
    storeList.isOpen = (store as any).isOpen ?? true;
    storeList.isOrderable = (store as any).isOrderable ?? true;
    storeList.availabilityStatus = (store as any).availabilityStatus ?? 'OPEN';
    storeList.availabilityLabel = (store as any).availabilityLabel ?? 'Open';
    storeList.nextOpeningLabel = (store as any).nextOpeningLabel ?? null;
    storeList.orderDisabledReason = (store as any).orderDisabledReason ?? null;
    return storeList;
  }

  mapStoresToStoreList(stores: Stores[]): StoreList[] {
    return stores.map((store) => this.mapStoreList(store));
  }

  mapMenuCategory(menuCategory: MenuCategory): MenuCategoryDto {
    return new MenuCategoryDto(
      menuCategory.id,
      menuCategory.userId,
      menuCategory.storeId,
      menuCategory.name,
      menuCategory.isPublished.toString(),
    );
  }

  mapMenuCategoryList(menuCategories: MenuCategory[]): MenuCategoryDto[] {
    return menuCategories.map((menuCategory) =>
      this.mapMenuCategory(menuCategory),
    );
  }

  mapMenuPack(menuPack: MenuPack): MenuPackDto {
    const dto = new MenuPackDto(
      menuPack.id,
      menuPack.userId,
      menuPack.storeId,
      menuPack.name,
      menuPack.isPublished,
    );
    return dto;
  }

  mapMenuPackList(menuPacks: MenuPack[]): MenuPackDto[] {
    return menuPacks.map((menuPack) => this.mapMenuPack(menuPack));
  }

  mapMenuItem(menuItem: MenuItem): MenuItemDto {
    return new MenuItemDto(
      menuItem.id,
      menuItem.name,
      menuItem.description,
      menuItem.images,
      menuItem.price,
      menuItem.isAvailable,
      menuItem.menuCategoryId,
      menuItem.isDiscountActive,
      menuItem.discountPrice,
      menuItem.discountPercentage,
      menuItem.discountStart,
      menuItem.discountEnd,
      menuItem.storeId,
      menuItem.createdAt.toISOString(),
      menuItem.updatedAt.toISOString(),
      menuItem.optionGroupIds || [],
    );
  }

  mapMenuItemList(menuItem: MenuItem): MenuItemListDto {
    return new MenuItemListDto(
      menuItem.id,
      menuItem.menuCategoryId,
      menuItem.name,
      menuItem.description,
      menuItem.images?.[0] || '',
      menuItem.price,
      menuItem.isAvailable,
      menuItem.isDiscountActive,
      menuItem.discountPrice,
      menuItem.discountPercentage,
      menuItem.discountStart,
      menuItem.discountEnd,
      menuItem.optionGroupIds || [],
    );
  }
}

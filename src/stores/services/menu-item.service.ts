import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';
import { MenuItem } from '../model/menu-item.entity';
import { MenuItemRequest } from '../model/dtos/menu-item.request';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { StoreService } from './stores.service';
import { StoreMapper } from './stores.mapper';
import { PaginationRequest } from '../../common/module/pagination-request';
import { MenuCategoryService } from './menu-category.service';
import { MenuPackService } from './menu-pack.service';
import { UpdateMenuDiscountDto } from '../model/dtos/update-menu-discount.dto';
import { StoreCategory } from '../model/enums/store.category';
import { Stores } from '../model/stores.entity';
import { UserCredentialStatus } from '../../users/model/user-credential.enum';
import { MenuOptionGroup } from '../model/menu-option-group.entity';
import {
  ResolvedMenuOptions,
  SelectedMenuOptionRequest,
  SelectedMenuOptionSnapshot,
} from '../model/menu-option-selection';

@Injectable()
export class MenuItemService {
  constructor(
    @InjectRepository(MenuItem)
    private readonly menuItemRepository: Repository<MenuItem>,
    @InjectRepository(Stores)
    private readonly storeRepository: Repository<Stores>,
    @InjectRepository(MenuOptionGroup)
    private readonly menuOptionGroupRepository: Repository<MenuOptionGroup>,
    private readonly commonService: CommonService,
    private readonly menuCategoryService: MenuCategoryService,
    private readonly menuPackService: MenuPackService,
    private readonly storeService: StoreService,
  ) {}

  async createMenuItem(
    storeId: string,
    menuItemDto: MenuItemRequest,
  ): Promise<StandardResponse> {
    const newMenuItem = new MenuItem();
    const authenticatedUser = await this.commonService.getLoggedInUser();

    // Verify store ownership
    await this.assertStoreOwner(storeId, authenticatedUser.id);

    // Ensure name uniqueness
    const existingMenuItemWithName = await this.menuItemRepository.findOne({
      where: { storeId, name: menuItemDto.name },
    });

    if (existingMenuItemWithName) {
      throw new BadRequestException(
        new StandardResponse(true, 'MENU_ITEM_NAME_ALREADY_EXISTS'),
      );
    }

    // Validate category
    await this.assertMenuCategoryOwner(
      menuItemDto.menuCategoryId,
      storeId,
      authenticatedUser.id,
    );
    const optionGroupIds = await this.assertOptionGroupsOwner(
      menuItemDto.optionGroupIds || [],
      storeId,
      authenticatedUser.id,
    );

    // Map base menu item first (use incoming values)
    Object.assign(newMenuItem, {
      ...menuItemDto,
      optionGroupIds,
      storeId,
      userId: authenticatedUser.id,
    });

    // Normalize numeric fields (protect against strings)
    // NOTE: keep original values if undefined/null
    if (newMenuItem.price != null)
      newMenuItem.price = Number(newMenuItem.price);
    if (newMenuItem.discountPrice != null)
      newMenuItem.discountPrice = Number(newMenuItem.discountPrice);
    if (newMenuItem.discountPercentage != null)
      newMenuItem.discountPercentage = Number(newMenuItem.discountPercentage);

    // Validate price present and positive
    if (
      newMenuItem.price == null ||
      Number.isNaN(newMenuItem.price) ||
      newMenuItem.price <= 0
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_PRICE'),
      );
    }

    // Handle discount logic
    if (newMenuItem.isDiscountActive) {
      // If neither provided → error
      const hasDiscountPrice =
        newMenuItem.discountPrice != null &&
        !Number.isNaN(newMenuItem.discountPrice);
      const hasDiscountPercentage =
        newMenuItem.discountPercentage != null &&
        !Number.isNaN(newMenuItem.discountPercentage);

      if (!hasDiscountPrice && !hasDiscountPercentage) {
        throw new BadRequestException(
          new StandardResponse(true, 'DISCOUNT_VALUE_REQUIRED'),
        );
      }

      // If discountPrice provided but percentage missing => compute percentage **as remaining %**
      if (hasDiscountPrice && !hasDiscountPercentage) {
        // ensure discountPrice is not greater than price
        if (newMenuItem.discountPrice > newMenuItem.price) {
          throw new BadRequestException(
            new StandardResponse(true, 'INVALID_DISCOUNT_PRICE'),
          );
        }
        newMenuItem.discountPercentage = Math.round(
          (newMenuItem.discountPrice / newMenuItem.price) * 100,
        );
      }

      // If percentage provided but price missing => compute price from percentage (percentage treated as remaining %)
      if (hasDiscountPrice && !hasDiscountPercentage) {
        if (newMenuItem.discountPrice > newMenuItem.price) {
          throw new BadRequestException(
            new StandardResponse(true, 'INVALID_DISCOUNT_PRICE'),
          );
        }

        newMenuItem.discountPercentage =
          (newMenuItem.discountPrice / newMenuItem.price) * 100;
      }

      // Calculate discountPrice from percentage
      if (hasDiscountPercentage && !hasDiscountPrice) {
        if (
          newMenuItem.discountPercentage < 0 ||
          newMenuItem.discountPercentage > 100
        ) {
          throw new BadRequestException(
            new StandardResponse(true, 'INVALID_DISCOUNT_PERCENTAGE'),
          );
        }

        newMenuItem.discountPrice =
          (newMenuItem.discountPercentage / 100) * newMenuItem.price;
      }

      // ensure dates are normalized or null
      newMenuItem.discountStart = newMenuItem.discountStart ?? null;
      newMenuItem.discountEnd = newMenuItem.discountEnd ?? null;
    } else {
      // Discount explicitly disabled
      newMenuItem.isDiscountActive = false;
      newMenuItem.discountPercentage = null;
      newMenuItem.discountPrice = null;
      newMenuItem.discountStart = null;
      newMenuItem.discountEnd = null;
    }

    await this.menuItemRepository.save(newMenuItem);

    return new StandardResponse(
      false,
      'MENU_ITEM_CREATED_SUCCESSFULLY',
      new StoreMapper().mapMenuItem(newMenuItem),
    );
  }

  async updateMenuItem(
    storeId: string,
    menuId: string,
    menuItemDto: MenuItemRequest,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    await this.assertStoreOwner(storeId, authenticatedUser.id);

    const menuItem = await this.menuItemRepository.findOne({
      where: { id: menuId, storeId },
    });

    if (!menuItem) {
      throw new NotFoundException(
        new StandardResponse(true, 'MENU_ITEM_NOT_FOUND'),
      );
    }

    await this.assertMenuCategoryOwner(
      menuItemDto.menuCategoryId,
      storeId,
      authenticatedUser.id,
    );
    const optionGroupIds = await this.assertOptionGroupsOwner(
      menuItemDto.optionGroupIds || [],
      storeId,
      authenticatedUser.id,
    );

    Object.assign(menuItem, menuItemDto, { optionGroupIds });
    await this.menuItemRepository.save(menuItem);

    return new StandardResponse(
      false,
      'MENU_ITEM_UPDATED_SUCCESSFULLY',
      new StoreMapper().mapMenuItem(menuItem),
    );
  }

  async getMenuItems(
    storeId: string,
    paginationRequest: PaginationRequest,
  ): Promise<StandardResponse> {
    const queryBuilder = this.menuItemRepository
      .createQueryBuilder('menuItem')
      .leftJoinAndSelect('menuItem.menuCategory', 'menuCategory')
      .leftJoinAndSelect('menuItem.menuPack', 'menuPack')
      .where('menuItem.storeId = :storeId', { storeId });

    if (paginationRequest.search) {
      queryBuilder.andWhere(
        '(menuItem.name ILIKE :search OR menuItem.description ILIKE :search)',
        { search: `%${paginationRequest.search}%` },
      );
    }

    if (paginationRequest.filter?.menuCategoryId) {
      queryBuilder.andWhere('menuItem.menuCategoryId = :menuCategoryId', {
        menuCategoryId: paginationRequest.filter.menuCategoryId,
      });
    }

    if (paginationRequest.filter?.isAvailable !== undefined) {
      queryBuilder.andWhere('menuItem.isAvailable = :isAvailable', {
        isAvailable: paginationRequest.filter.isAvailable,
      });
    }

    // Keep merchant and customer catalogues predictably alphabetical. The ID
    // tie-breaker makes pagination stable when two products share a name.
    // TypeORM's joined pagination parser mistakes a raw LOWER(menuItem.name)
    // ORDER BY expression for an entity alias, so select the expression under
    // a safe SQL alias and order by that alias instead. Keep the alias entirely
    // lowercase: TypeORM reuses it in the second pagination query without
    // quoting it, and PostgreSQL folds unquoted identifiers to lowercase.
    queryBuilder
      .addSelect('LOWER(menuItem.name)', 'menu_item_name_lower')
      .orderBy('menu_item_name_lower', 'ASC')
      .addOrderBy('menuItem.id', 'ASC');

    if (paginationRequest.page && paginationRequest.size) {
      queryBuilder
        .skip((paginationRequest.page - 1) * paginationRequest.size)
        .take(paginationRequest.size);
    }

    const [menuItems, total] = await queryBuilder.getManyAndCount();

    const menuItemsList = menuItems.map((item) => {
      const mapped = new StoreMapper().mapMenuItemList(item);

      return {
        ...mapped,
      };
    });

    return StandardResponse.withPagination(
      'MENU_ITEMS_FETCHED_SUCCESSFULLY',
      menuItemsList,
      paginationRequest,
      total,
    );
  }

  async getMenuItem(
    storeId: string,
    menuId: string,
  ): Promise<StandardResponse> {
    const menuItem = await this.findMenuItemByIdAndStoreId(menuId, storeId);
    const mapped = new StoreMapper().mapMenuItemList(menuItem);
    const optionGroups = await this.getPublishedOptionGroups(menuItem);

    return new StandardResponse(false, 'MENU_ITEM_FETCHED_SUCCESSFULLY', {
      ...mapped,
      finalPrice: this.getFinalMenuPrice(menuItem),
      storeId: menuItem.storeId,
      images: menuItem.images || [],
      optionGroupIds: menuItem.optionGroupIds || [],
      optionGroups,
    });
  }

  public async findMenuItemByIdAndStoreId(menuId: string, storeId: string) {
    const menuItem = await this.menuItemRepository.findOne({
      where: { id: menuId, storeId },
    });

    if (!menuItem) {
      throw new NotFoundException(
        new StandardResponse(true, 'MENU_ITEM_NOT_FOUND'),
      );
    }
    return menuItem;
  }

  public async findMenuItemAttachStore(menuId: string) {
    const menuItem = await this.menuItemRepository.findOne({
      where: { id: menuId },
      relations: ['store'],
    });

    if (!menuItem) {
      throw new NotFoundException(
        new StandardResponse(true, 'MENU_ITEM_NOT_FOUND'),
      );
    }
    return menuItem;
  }

  async updateMenuItemAvailability(
    storeId: string,
    menuId: string,
    isAvailable: boolean,
  ): Promise<StandardResponse> {
    const menuItem = await this.menuItemRepository.findOne({
      where: { id: menuId, storeId },
    });

    if (!menuItem) {
      throw new NotFoundException(
        new StandardResponse(true, 'MENU_ITEM_NOT_FOUND'),
      );
    }

    menuItem.isAvailable = isAvailable;
    await this.menuItemRepository.save(menuItem);

    return new StandardResponse(
      false,
      'MENU_ITEM_AVAILABILITY_UPDATED_SUCCESSFULLY',
      new StoreMapper().mapMenuItem(menuItem),
    );
  }
  async deleteMenuItem(
    storeId: string,
    menuId: string,
  ): Promise<StandardResponse> {
    const menuItem = await this.findMenuItemByIdAndStoreId(menuId, storeId);
    await this.menuItemRepository.remove(menuItem);
    return new StandardResponse(false, 'MENU_ITEM_DELETED_SUCCESSFULLY');
  }
  async markAsOutOfStock(id: string) {
    const item = await this.menuItemRepository.findOne({ where: { id } });
    if (!item)
      throw new NotFoundException(
        new StandardResponse(true, 'MENU_ITEM_NOT_FOUND'),
      );

    item.isAvailable = false;
    const updatedItem = await this.menuItemRepository.save(item);
    return new StandardResponse(
      false,
      'MENU_ITEM_MARKED_AS_OUT_OF_STOCK_SUCCESSFULLY',
      updatedItem,
    );
  }
  async markAsInStock(id: string) {
    const item = await this.menuItemRepository.findOne({ where: { id } });
    if (!item)
      throw new NotFoundException(
        new StandardResponse(true, 'MENU_ITEM_NOT_FOUND'),
      );

    item.isAvailable = true;
    const updatedItem = await this.menuItemRepository.save(item);
    return new StandardResponse(
      false,
      'MENU_ITEM_MARKED_AS_IN_STOCK_SUCCESSFULLY',
      updatedItem,
    );
  }
  async updateMenuItemDiscount(id: string, dto: UpdateMenuDiscountDto) {
    const menu = await this.menuItemRepository.findOne({
      where: { id },
      relations: ['store'],
    });

    if (!menu) {
      throw new NotFoundException('Menu item not found');
    }

    // merchant/store ownership validation optional
    // if (menu.storeId !== merchantId) throw new ForbiddenException();

    if (dto.discountPrice && dto.discountPercentage) {
      throw new BadRequestException(
        'Choose either discountPrice OR discountPercentage',
      );
    }

    // Apply DTO to entity
    Object.assign(menu, dto);

    // Reset when deactivating discount
    if (dto.isDiscountActive === false) {
      menu.discountPrice = null;
      menu.discountPercentage = null;
      menu.discountStart = null;
      menu.discountEnd = null;
    }

    return await this.menuItemRepository.save(menu);
  }
  getFinalMenuPrice(menu: MenuItem): number {
    const now = new Date();

    // No discount active
    if (!menu.isDiscountActive) return Number(menu.price);

    const price = Number(menu.price);

    // Parse discount schedule
    const hasStart = menu.discountStart != null;
    const hasEnd = menu.discountEnd != null;

    // Validate discount window
    if (hasStart && now < new Date(menu.discountStart)) {
      return price;
    }
    if (hasEnd && now > new Date(menu.discountEnd)) {
      return price;
    }

    // If discount price is provided → ALWAYS use it
    if (menu.discountPrice != null) {
      return Number(menu.discountPrice);
    }

    // If discount percentage is provided → calculate
    if (menu.discountPercentage != null) {
      const pct = Number(menu.discountPercentage);
      const discountAmount = price * (pct / 100);
      return price - discountAmount;
    }

    // Fallback to base price
    return price;
  }
  async getMenuItemsAI(query: string) {
    const menuItems = await this.menuItemRepository.find({
      where: [
        { name: ILike(`%${query}%`) },
        { description: ILike(`%${query}%`) },
      ],
      relations: ['store', 'store.address', 'menuCategory'],
    });
    return menuItems.map((item) => ({
      ...item,
      finalPrice: this.getFinalMenuPrice(item),
      storeAddress: item.store?.address || null,
    }));
  }

  async searchDiscovery(
    query: string,
    category?: StoreCategory,
    accessKey?: string,
  ) {
    const eligibleStoreIds =
      await this.storeService.getCustomerDiscoveryStoreIds(accessKey);
    return this.searchDiscoveryWithinScope([query], category, eligibleStoreIds);
  }

  async searchDiscoveryForUser(
    query: string,
    userId: string,
    category?: StoreCategory,
  ) {
    return (await this.searchDiscoveryWithScopeForUser(query, userId, category))
      .response;
  }

  async searchDiscoveryWithScopeForUser(
    query: string,
    userId: string,
    category?: StoreCategory,
  ) {
    return this.searchDiscoveryTermsWithScopeForUser([query], userId, category);
  }

  async searchDiscoveryTermsWithScopeForUser(
    queries: string[],
    userId: string,
    category?: StoreCategory,
  ) {
    const scope =
      await this.storeService.getCustomerDiscoveryScopeForUser(userId);
    const eligibleStoreIds = scope.eligibleStoreIds;
    if (eligibleStoreIds === null) {
      return {
        response: new StandardResponse(false, 'SEARCH_LOCATION_REQUIRED', []),
        selectedLocation: scope.selectedLocation,
      };
    }
    return {
      response: await this.searchDiscoveryWithinScope(
        queries,
        category,
        eligibleStoreIds,
        scope.selectedLocation,
      ),
      selectedLocation: scope.selectedLocation,
    };
  }

  private async searchDiscoveryWithinScope(
    queries: string[],
    category: StoreCategory | undefined,
    eligibleStoreIds: string[] | null,
    customerLocation?: unknown,
  ) {
    const normalizedQueries = queries
      .map((query) => query?.trim().slice(0, 80))
      .filter((query): query is string => Boolean(query && query.length >= 2))
      .filter(
        (query, index, all) =>
          all.findIndex(
            (candidate) => candidate.toLowerCase() === query.toLowerCase(),
          ) === index,
      )
      .slice(0, 4);
    if (!normalizedQueries.length) {
      return new StandardResponse(
        false,
        'SEARCH_RESULTS_FETCHED_SUCCESSFULLY',
        [],
      );
    }

    const allowedCategories = Object.values(StoreCategory);
    const selectedCategory = allowedCategories.includes(category)
      ? category
      : undefined;
    const termParameters = Object.fromEntries(
      normalizedQueries.map((query, index) => [
        `term${index}`,
        `%${query.replace(/[\\%_]/g, '\\$&')}%`,
      ]),
    );
    const storeSearch = normalizedQueries
      .map((_, index) => `store.name ILIKE :term${index} ESCAPE '\\'`)
      .join(' OR ');
    const itemSearch = normalizedQueries
      .map(
        (_, index) =>
          `(menuItem.name ILIKE :term${index} ESCAPE '\\' OR menuItem.description ILIKE :term${index} ESCAPE '\\')`,
      )
      .join(' OR ');
    // An authenticated user with a selected but unsupported city/state must
    // receive no nationwide fallback results. This matches the homepage.
    if (eligibleStoreIds?.length === 0) {
      return new StandardResponse(
        false,
        'SEARCH_RESULTS_FETCHED_SUCCESSFULLY',
        [],
      );
    }

    const storeQuery = this.storeRepository
      .createQueryBuilder('store')
      .innerJoin('store.user', 'vendor')
      .leftJoinAndSelect('store.address', 'address')
      .leftJoinAndSelect('store.openingSchedules', 'openingSchedule')
      .leftJoinAndSelect('openingSchedule.schedules', 'daySchedule')
      .where(`(${storeSearch})`, termParameters)
      .andWhere('vendor.verificationStatus = :approvedStatus', {
        approvedStatus: UserCredentialStatus.APPROVED,
      })
      .andWhere('store.isSuspended = :suspended', { suspended: false })
      .orderBy('LOWER(store.name)', 'ASC')
      .take(20);

    const itemQuery = this.menuItemRepository
      .createQueryBuilder('menuItem')
      .innerJoinAndSelect('menuItem.store', 'store')
      .innerJoin('store.user', 'vendor')
      .leftJoinAndSelect('store.address', 'address')
      .leftJoinAndSelect('store.openingSchedules', 'openingSchedule')
      .leftJoinAndSelect('openingSchedule.schedules', 'daySchedule')
      .innerJoinAndSelect('menuItem.menuCategory', 'menuCategory')
      .where(`(${itemSearch})`, termParameters)
      .andWhere('vendor.verificationStatus = :approvedStatus', {
        approvedStatus: UserCredentialStatus.APPROVED,
      })
      .andWhere('store.isSuspended = :suspended', { suspended: false })
      .andWhere('menuCategory.isPublished = :published', { published: true })
      .andWhere('menuItem.isAvailable = :available', { available: true })
      .orderBy('LOWER(store.name)', 'ASC')
      .addOrderBy('LOWER(menuItem.name)', 'ASC')
      .take(100);

    if (eligibleStoreIds) {
      const locationFilter = { eligibleStoreIds };
      storeQuery.andWhere('store.id IN (:...eligibleStoreIds)', locationFilter);
      itemQuery.andWhere('store.id IN (:...eligibleStoreIds)', locationFilter);
    }

    if (selectedCategory === StoreCategory.GROCERY) {
      storeQuery.andWhere('store.category IN (:...categories)', {
        categories: [StoreCategory.GROCERY, StoreCategory.SUPER_MARKET],
      });
      itemQuery.andWhere('store.category IN (:...categories)', {
        categories: [StoreCategory.GROCERY, StoreCategory.SUPER_MARKET],
      });
    } else if (selectedCategory) {
      storeQuery.andWhere('store.category = :category', {
        category: selectedCategory,
      });
      itemQuery.andWhere('store.category = :category', {
        category: selectedCategory,
      });
    }

    const [matchingStores, menuItems] = await Promise.all([
      storeQuery.getMany(),
      itemQuery.getMany(),
    ]);
    const grouped = new Map<string, any>();

    const addStore = (store: Stores) => {
      if (!store) return null;
      let result = grouped.get(store.id);
      if (!result) {
        if (grouped.size >= 20) return null;
        const availability = this.storeService.getStoreAvailability(store);
        result = {
          store: {
            id: store.id,
            name: store.name,
            coverImage: store.coverImage,
            category: store.category,
            location: store.address?.address || '',
            distanceKm: this.distanceBetweenLocations(
              customerLocation,
              store.address,
            ),
            ...availability,
          },
          matchedItems: [],
        };
        grouped.set(store.id, result);
      }
      return result;
    };

    // Merchant-name matches are independent from product matches so a store
    // with a large menu cannot crowd other matching merchants out of results.
    matchingStores.forEach(addStore);

    for (const item of menuItems) {
      const result = item.store ? addStore(item.store) : null;
      if (!result || result.matchedItems.length >= 5) continue;

      result.matchedItems.push({
        id: item.id,
        storeId: item.storeId,
        menuCategoryId: item.menuCategoryId,
        name: item.name,
        description: item.description,
        image: item.images?.[0] || '',
        images: item.images || [],
        price: Number(item.price),
        finalPrice: this.getFinalMenuPrice(item),
        isAvailable: item.isAvailable,
        isDiscountActive: item.isDiscountActive,
        discountPrice:
          item.discountPrice === null ? null : Number(item.discountPrice),
        discountPercentage:
          item.discountPercentage === null
            ? null
            : Number(item.discountPercentage),
        discountStart: item.discountStart,
        discountEnd: item.discountEnd,
        optionGroupIds: item.optionGroupIds || [],
      });
    }

    const results = Array.from(grouped.values()).sort((left, right) => {
      const leftDistance = left.store?.distanceKm;
      const rightDistance = right.store?.distanceKm;
      const leftKnown = Number.isFinite(leftDistance);
      const rightKnown = Number.isFinite(rightDistance);
      if (leftKnown && rightKnown) return leftDistance - rightDistance;
      if (leftKnown) return -1;
      if (rightKnown) return 1;
      return 0;
    });
    return new StandardResponse(
      false,
      'SEARCH_RESULTS_FETCHED_SUCCESSFULLY',
      results,
    );
  }

  private async assertStoreOwner(storeId: string, vendorId: string) {
    const ownsStore = await this.storeService.existingByStoreIdAndVendorId(
      storeId,
      vendorId,
    );
    if (!ownsStore) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }
  }

  private async assertMenuCategoryOwner(
    menuCategoryId: string,
    storeId: string,
    vendorId: string,
  ) {
    const ownsCategory =
      await this.menuCategoryService.existingByIdStoreAndVendorId(
        menuCategoryId,
        storeId,
        vendorId,
      );
    if (!ownsCategory) {
      throw new NotFoundException(
        new StandardResponse(true, 'MENU_CATEGORY_NOT_FOUND'),
      );
    }
  }

  private async assertOptionGroupsOwner(
    optionGroupIds: string[],
    storeId: string,
    vendorId: string,
  ) {
    const uniqueIds = [...new Set(optionGroupIds.filter(Boolean))];
    if (!uniqueIds.length) return [];
    const groups = await this.menuOptionGroupRepository.findBy({
      id: In(uniqueIds),
      storeId,
      userId: vendorId,
    });
    if (groups.length !== uniqueIds.length) {
      throw new NotFoundException(
        new StandardResponse(true, 'MENU_OPTION_GROUP_NOT_FOUND'),
      );
    }
    return uniqueIds;
  }

  async getPublishedOptionGroups(menuItem: MenuItem) {
    const ids = [...new Set(menuItem.optionGroupIds || [])];
    if (!ids.length) return [];
    return this.menuOptionGroupRepository.find({
      where: {
        id: In(ids),
        storeId: menuItem.storeId,
        isPublished: true,
      },
      order: { name: 'ASC' },
    });
  }

  async getPublishedOptionGroupsForItems(
    items: Array<Pick<MenuItem, 'id' | 'storeId' | 'optionGroupIds'>>,
  ): Promise<Record<string, MenuOptionGroup[]>> {
    const groupIds = [
      ...new Set(items.flatMap((item) => item.optionGroupIds || [])),
    ];
    if (!groupIds.length) return {};
    const storeIds = [...new Set(items.map((item) => item.storeId))];

    const groups = await this.menuOptionGroupRepository.find({
      where: {
        id: In(groupIds),
        storeId: In(storeIds),
        isPublished: true,
      },
      order: { name: 'ASC' },
    });
    const groupsById = new Map(groups.map((group) => [group.id, group]));

    return Object.fromEntries(
      items.map((item) => [
        item.id,
        (item.optionGroupIds || [])
          .map((id) => groupsById.get(id))
          .filter((group): group is MenuOptionGroup =>
            Boolean(group && group.storeId === item.storeId),
          ),
      ]),
    );
  }

  async resolveSelectedOptions(
    menuItem: MenuItem,
    selections: SelectedMenuOptionRequest[] = [],
    publishedGroups?: MenuOptionGroup[],
  ): Promise<ResolvedMenuOptions> {
    const groups =
      publishedGroups || (await this.getPublishedOptionGroups(menuItem));
    const groupsById = new Map(groups.map((group) => [group.id, group]));
    const selectionsByGroup = new Map<string, string[]>();

    for (const selection of selections || []) {
      if (
        !groupsById.has(selection.groupId) ||
        selectionsByGroup.has(selection.groupId)
      ) {
        throw new BadRequestException(
          new StandardResponse(true, 'INVALID_MENU_OPTION_SELECTION'),
        );
      }
      selectionsByGroup.set(selection.groupId, [
        ...new Set(selection.choiceIds || []),
      ]);
    }

    const selectedOptions: SelectedMenuOptionSnapshot[] = [];
    let optionPrice = 0;
    for (const group of groups) {
      const choiceIds = selectionsByGroup.get(group.id) || [];
      if (group.isRequired && choiceIds.length === 0) {
        throw new BadRequestException(
          new StandardResponse(true, 'REQUIRED_MENU_OPTION_MISSING'),
        );
      }
      if (!group.allowMultiple && choiceIds.length > 1) {
        throw new BadRequestException(
          new StandardResponse(true, 'TOO_MANY_MENU_OPTIONS_SELECTED'),
        );
      }
      if (!choiceIds.length) continue;

      const choicesById = new Map(
        (group.choices || []).map((choice) => [choice.id, choice]),
      );
      const selectedChoices = choiceIds.map((choiceId) => {
        const choice = choicesById.get(choiceId);
        if (!choice) {
          throw new BadRequestException(
            new StandardResponse(true, 'INVALID_MENU_OPTION_SELECTION'),
          );
        }
        const priceAdjustment = Number(choice.priceAdjustment || 0);
        optionPrice += priceAdjustment;
        if (optionPrice > 99999999.99) {
          throw new BadRequestException(
            new StandardResponse(true, 'MENU_OPTION_PRICE_TOO_LARGE'),
          );
        }
        return { ...choice, priceAdjustment };
      });
      selectedOptions.push({
        groupId: group.id,
        groupName: group.name,
        choices: selectedChoices,
      });
    }

    const configurationKey = selectedOptions
      .map(
        (group) =>
          `${group.groupId}:${group.choices
            .map((choice) => choice.id)
            .sort()
            .join(',')}`,
      )
      .sort()
      .join('|');
    return { selectedOptions, optionPrice, configurationKey };
  }

  private distanceBetweenLocations(
    origin: unknown,
    destination: unknown,
  ): number | null {
    if (!origin || !destination) return null;
    const from = origin as Record<string, unknown>;
    const to = destination as Record<string, unknown>;
    const coordinate = (value: unknown): number | null => {
      if (
        value === null ||
        value === undefined ||
        (typeof value === 'string' && !value.trim())
      ) {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };
    const latitude1 = coordinate(from.latitude);
    const longitude1 = coordinate(from.longitude);
    const latitude2 = coordinate(to.latitude);
    const longitude2 = coordinate(to.longitude);
    if (
      latitude1 === null ||
      longitude1 === null ||
      latitude2 === null ||
      longitude2 === null ||
      Math.abs(latitude1) > 90 ||
      Math.abs(latitude2) > 90 ||
      Math.abs(longitude1) > 180 ||
      Math.abs(longitude2) > 180
    ) {
      return null;
    }
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    const latitudeDelta = radians(latitude2 - latitude1);
    const longitudeDelta = radians(longitude2 - longitude1);
    const a =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(radians(latitude1)) *
        Math.cos(radians(latitude2)) *
        Math.sin(longitudeDelta / 2) ** 2;
    // Floating-point rounding can push the Haversine value infinitesimally
    // outside [0, 1] for antipodal coordinates and otherwise produce NaN.
    const boundedA = Math.min(1, Math.max(0, a));
    const kilometres =
      6371 * 2 * Math.atan2(Math.sqrt(boundedA), Math.sqrt(1 - boundedA));
    return Math.round(kilometres * 10) / 10;
  }
}

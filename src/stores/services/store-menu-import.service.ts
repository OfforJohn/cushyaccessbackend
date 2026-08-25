import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { CommonService } from '../../common/common.service';
import { StandardResponse } from '../../common/module/standard-response';
import { Cart } from '../../orders/model/cart.entity';
import { MenuCategory } from '../model/menu-category.entity';
import { MenuItem } from '../model/menu-item.entity';
import { MenuOptionGroup } from '../model/menu-option-group.entity';
import { MenuPack } from '../model/menu-pack.entity';
import { Stores } from '../model/stores.entity';
import { ImportStoreMenuDto } from '../model/dtos/store-access.dto';

type ImportPreview = {
  sourceStore: { id: string; name: string | null };
  targetStore: { id: string; name: string | null };
  source: {
    products: number;
    categories: number;
    packs: number;
    optionGroups: number;
  };
  targetProductsToReplace: number;
  activeCartsToClear: number;
};

@Injectable()
export class StoreMenuImportService {
  constructor(
    @InjectRepository(Stores)
    private readonly storeRepository: Repository<Stores>,
    private readonly commonService: CommonService,
  ) {}

  async preview(
    sourceStoreId: string,
    targetStoreId: string,
  ): Promise<StandardResponse> {
    this.assertStoreIds(sourceStoreId, targetStoreId);
    const user = await this.commonService.getLoggedInUser();
    const [sourceStore, targetStore] = await Promise.all([
      this.storeRepository.findOne({
        where: { id: sourceStoreId, userId: user.id },
      }),
      this.storeRepository.findOne({
        where: { id: targetStoreId, userId: user.id },
      }),
    ]);
    this.assertImportStores(sourceStore, targetStore);

    const manager = this.storeRepository.manager;
    const [products, categories, packs, optionGroups, targetProducts, carts] =
      await Promise.all([
        manager.count(MenuItem, { where: { storeId: sourceStoreId } }),
        manager.count(MenuCategory, { where: { storeId: sourceStoreId } }),
        manager.count(MenuPack, { where: { storeId: sourceStoreId } }),
        manager.count(MenuOptionGroup, { where: { storeId: sourceStoreId } }),
        manager.count(MenuItem, { where: { storeId: targetStoreId } }),
        manager.count(Cart, { where: { storeId: targetStoreId } }),
      ]);

    const preview: ImportPreview = {
      sourceStore: { id: sourceStore!.id, name: sourceStore!.name || null },
      targetStore: { id: targetStore!.id, name: targetStore!.name || null },
      source: { products, categories, packs, optionGroups },
      targetProductsToReplace: targetProducts,
      activeCartsToClear: carts,
    };
    return new StandardResponse(false, 'STORE_MENU_IMPORT_PREVIEW', preview);
  }

  async import(
    targetStoreId: string,
    dto: ImportStoreMenuDto,
  ): Promise<StandardResponse> {
    this.assertStoreIds(dto.sourceStoreId, targetStoreId);
    const user = await this.commonService.getLoggedInUser();

    const result = await this.storeRepository.manager.transaction(
      'SERIALIZABLE',
      async (manager) => {
        // Serializes imports for this receiver across every API instance and
        // makes repeated taps harmless while leaving other stores independent.
        const [lock] = await manager.query(
          "SELECT pg_try_advisory_xact_lock(hashtext('store-menu-import'), hashtext($1)) AS acquired",
          [targetStoreId],
        );
        if (!lock?.acquired) {
          throw new BadRequestException(
            new StandardResponse(true, 'STORE_MENU_IMPORT_IN_PROGRESS'),
          );
        }

        const storeIds = [dto.sourceStoreId, targetStoreId].sort();
        const stores = await manager
          .getRepository(Stores)
          .createQueryBuilder('store')
          .addSelect('store.branchPasswordHash')
          .setLock('pessimistic_write')
          .where('store.id IN (:...storeIds)', { storeIds })
          .andWhere('store.userId = :userId', { userId: user.id })
          .orderBy('store.id', 'ASC')
          .getMany();
        const sourceStore = stores.find(
          (store) => store.id === dto.sourceStoreId,
        );
        const targetStore = stores.find((store) => store.id === targetStoreId);
        this.assertImportStores(sourceStore, targetStore);

        if (!targetStore!.branchPasswordHash) {
          throw new BadRequestException(
            new StandardResponse(true, 'STORE_PASSWORD_NOT_CONFIGURED'),
          );
        }
        const passwordMatches = await bcrypt.compare(
          dto.password,
          targetStore!.branchPasswordHash,
        );
        if (!passwordMatches) {
          throw new UnauthorizedException(
            new StandardResponse(true, 'INCORRECT_PASSWORD'),
          );
        }

        const [sourceCategories, sourcePacks, sourceOptionGroups, sourceItems] =
          await Promise.all([
            manager.find(MenuCategory, {
              where: { storeId: dto.sourceStoreId, userId: user.id },
              order: { name: 'ASC' },
            }),
            manager.find(MenuPack, {
              where: { storeId: dto.sourceStoreId, userId: user.id },
              order: { name: 'ASC' },
            }),
            manager.find(MenuOptionGroup, {
              where: { storeId: dto.sourceStoreId, userId: user.id },
              order: { name: 'ASC' },
            }),
            manager.find(MenuItem, {
              where: { storeId: dto.sourceStoreId },
              relations: ['menuPack'],
              order: { name: 'ASC' },
            }),
          ]);
        if (sourceItems.length === 0) {
          throw new BadRequestException(
            new StandardResponse(true, 'SOURCE_STORE_MENU_EMPTY'),
          );
        }

        this.assertUniqueNormalizedNames(
          sourceCategories,
          'SOURCE_MENU_CATEGORY_NAMES_DUPLICATED',
        );
        this.assertUniqueNormalizedNames(
          sourceOptionGroups,
          'SOURCE_MENU_OPTION_GROUP_NAMES_DUPLICATED',
        );

        const sourceCategoryIds = new Set(
          sourceCategories.map((entry) => entry.id),
        );
        const sourcePackIds = new Set(sourcePacks.map((entry) => entry.id));
        const sourceOptionGroupIds = new Set(
          sourceOptionGroups.map((entry) => entry.id),
        );
        for (const item of sourceItems) {
          if (!sourceCategoryIds.has(item.menuCategoryId)) {
            throw new BadRequestException(
              new StandardResponse(true, 'SOURCE_MENU_CATEGORY_INVALID'),
            );
          }
          if (item.menuPack?.id && !sourcePackIds.has(item.menuPack.id)) {
            throw new BadRequestException(
              new StandardResponse(true, 'SOURCE_MENU_PACK_INVALID'),
            );
          }
          if (
            (item.optionGroupIds || []).some(
              (id) => !sourceOptionGroupIds.has(id),
            )
          ) {
            throw new BadRequestException(
              new StandardResponse(true, 'SOURCE_MENU_OPTION_GROUP_INVALID'),
            );
          }
        }

        const targetItemsBefore = await manager.count(MenuItem, {
          where: { storeId: targetStoreId },
        });
        const clearedCarts = await manager.count(Cart, {
          where: { storeId: targetStoreId },
        });
        await manager.delete(Cart, { storeId: targetStoreId });
        await manager.delete(MenuItem, { storeId: targetStoreId });
        await manager.delete(MenuOptionGroup, { storeId: targetStoreId });
        await manager.delete(MenuCategory, { storeId: targetStoreId });

        // Order items retain a relation to their historical pack. Keep those
        // rows and reuse a same-name pack where possible; remove only packs
        // that no historical order references.
        const referencedPackRows: Array<{ menuPackId: string }> =
          await manager.query(
            'SELECT DISTINCT order_item."menuPackId" FROM order_items order_item INNER JOIN menu_pack pack ON pack.id = order_item."menuPackId" WHERE pack."storeId" = $1',
            [targetStoreId],
          );
        const referencedPackIds = new Set(
          referencedPackRows.map((row) => row.menuPackId),
        );
        const targetPacks = await manager.find(MenuPack, {
          where: { storeId: targetStoreId },
        });
        const disposablePackIds = targetPacks
          .filter((pack) => !referencedPackIds.has(pack.id))
          .map((pack) => pack.id);
        if (disposablePackIds.length > 0) {
          await manager.delete(MenuPack, disposablePackIds);
        }
        const retainedPacks = targetPacks.filter((pack) =>
          referencedPackIds.has(pack.id),
        );
        if (retainedPacks.length > 0) {
          await manager.update(
            MenuPack,
            { id: In(retainedPacks.map((pack) => pack.id)) },
            { isPublished: false },
          );
        }

        const categoryIdMap = new Map<string, string>();
        const categories = sourceCategories.map((source) => {
          const category = manager.create(MenuCategory, {
            id: `mcg_${uuidv4()}`,
            userId: user.id,
            storeId: targetStoreId,
            name: source.name,
            normalizedName: this.normalizeName(source.name),
            isPublished: source.isPublished,
          });
          categoryIdMap.set(source.id, category.id);
          return category;
        });
        await manager.save(MenuCategory, categories, { listeners: false });

        const optionGroupIdMap = new Map<string, string>();
        const optionGroups = sourceOptionGroups.map((source) => {
          const group = manager.create(MenuOptionGroup, {
            id: `mog_${uuidv4()}`,
            userId: user.id,
            storeId: targetStoreId,
            name: source.name,
            normalizedName: this.normalizeName(source.name),
            isPublished: source.isPublished,
            isRequired: source.isRequired,
            allowMultiple: source.allowMultiple,
            choices: source.choices || [],
          });
          optionGroupIdMap.set(source.id, group.id);
          return group;
        });
        if (optionGroups.length > 0) {
          await manager.save(MenuOptionGroup, optionGroups, {
            listeners: false,
          });
        }

        const retainedByName = new Map(
          retainedPacks.map((pack) => [pack.name.trim().toLowerCase(), pack]),
        );
        const packIdMap = new Map<string, string>();
        const newPacks: MenuPack[] = [];
        for (const source of sourcePacks) {
          const retained = retainedByName.get(source.name.trim().toLowerCase());
          if (retained) {
            await manager.update(MenuPack, retained.id, {
              name: source.name,
              isPublished: source.isPublished,
            });
            packIdMap.set(source.id, retained.id);
            retainedByName.delete(source.name.trim().toLowerCase());
          } else {
            const pack = manager.create(MenuPack, {
              id: `mp_${uuidv4()}`,
              userId: user.id,
              storeId: targetStoreId,
              name: source.name,
              isPublished: source.isPublished,
            });
            packIdMap.set(source.id, pack.id);
            newPacks.push(pack);
          }
        }
        if (newPacks.length > 0) {
          await manager.save(MenuPack, newPacks, { listeners: false });
        }

        const items = sourceItems.map((source) => {
          const targetCategoryId = categoryIdMap.get(source.menuCategoryId)!;
          const targetPackId = source.menuPack?.id
            ? packIdMap.get(source.menuPack.id)
            : undefined;
          return manager.create(MenuItem, {
            id: `mit_${uuidv4()}`,
            storeId: targetStoreId,
            menuCategoryId: targetCategoryId,
            ...(targetPackId
              ? { menuPack: { id: targetPackId } as MenuPack }
              : {}),
            name: source.name,
            description: source.description,
            images: source.images ? [...source.images] : source.images,
            price: source.price,
            isAvailable: source.isAvailable,
            isDiscountActive: source.isDiscountActive,
            discountPrice: source.discountPrice,
            discountPercentage: source.discountPercentage,
            discountStart: source.discountStart,
            discountEnd: source.discountEnd,
            optionGroupIds: (source.optionGroupIds || []).map(
              (id) => optionGroupIdMap.get(id)!,
            ),
          });
        });
        await manager.save(MenuItem, items, { listeners: false, chunk: 100 });

        const copiedCount = await manager.count(MenuItem, {
          where: { storeId: targetStoreId },
        });
        if (copiedCount !== sourceItems.length) {
          throw new BadRequestException(
            new StandardResponse(true, 'STORE_MENU_IMPORT_VERIFICATION_FAILED'),
          );
        }

        return {
          sourceStoreId: dto.sourceStoreId,
          targetStoreId,
          productsCopied: copiedCount,
          categoriesCopied: categories.length,
          packsCopied: sourcePacks.length,
          optionGroupsCopied: optionGroups.length,
          targetProductsReplaced: targetItemsBefore,
          cartsCleared: clearedCarts,
        };
      },
    );

    return new StandardResponse(
      false,
      'STORE_MENU_IMPORTED_SUCCESSFULLY',
      result,
    );
  }

  private assertImportStores(
    sourceStore: Stores | null | undefined,
    targetStore: Stores | null | undefined,
  ) {
    if (!sourceStore || !targetStore) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }
    if (sourceStore.category !== targetStore.category) {
      throw new BadRequestException(
        new StandardResponse(true, 'STORE_CATEGORIES_MUST_MATCH'),
      );
    }
  }

  private assertStoreIds(sourceStoreId: string, targetStoreId: string) {
    if (!sourceStoreId?.trim() || !targetStoreId?.trim()) {
      throw new BadRequestException(
        new StandardResponse(true, 'SOURCE_AND_TARGET_STORE_REQUIRED'),
      );
    }
    if (sourceStoreId === targetStoreId) {
      throw new BadRequestException(
        new StandardResponse(true, 'SOURCE_AND_TARGET_STORE_MUST_DIFFER'),
      );
    }
  }

  private assertUniqueNormalizedNames(
    values: Array<{ name: string }>,
    message: string,
  ) {
    const names = new Set<string>();
    for (const value of values) {
      const normalized = this.normalizeName(value.name);
      if (!normalized || names.has(normalized)) {
        throw new BadRequestException(new StandardResponse(true, message));
      }
      names.add(normalized);
    }
  }

  private normalizeName(name: string) {
    return (name || '').trim().toLowerCase();
  }
}

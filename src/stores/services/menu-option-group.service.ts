import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Raw, Repository } from 'typeorm';
import { CommonService } from '../../common/common.service';
import { StandardResponse } from '../../common/module/standard-response';
import { MenuOptionGroupRequest } from '../model/dtos/menu-option-group.request';
import { MenuOptionGroup } from '../model/menu-option-group.entity';
import { MenuItem } from '../model/menu-item.entity';
import { StoreService } from './stores.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MenuOptionGroupService {
  constructor(
    @InjectRepository(MenuOptionGroup)
    private readonly optionGroupRepository: Repository<MenuOptionGroup>,
    private readonly commonService: CommonService,
    private readonly storeService: StoreService,
  ) {}

  async create(
    storeId: string,
    request: MenuOptionGroupRequest,
  ): Promise<StandardResponse> {
    const user = await this.commonService.getLoggedInUser();
    await this.assertStoreOwner(storeId, user.id);
    const normalizedName = this.normalizeName(request.name);
    await this.assertNameAvailable(storeId, normalizedName);
    const choices = this.normalizeChoices(request.choices || []);
    this.assertRequiredGroupHasChoices(request.isRequired ?? false, choices);

    const optionGroup = this.optionGroupRepository.create({
      storeId,
      userId: user.id,
      name: request.name.trim(),
      normalizedName,
      isPublished: request.isPublished ?? true,
      isRequired: request.isRequired ?? false,
      allowMultiple: request.allowMultiple ?? false,
      choices,
    });

    try {
      await this.optionGroupRepository.save(optionGroup);
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new BadRequestException(
          new StandardResponse(true, 'MENU_OPTION_GROUP_NAME_ALREADY_EXISTS'),
        );
      }
      throw error;
    }

    return new StandardResponse(
      false,
      'MENU_OPTION_GROUP_CREATED_SUCCESSFULLY',
      optionGroup,
    );
  }

  async list(storeId: string): Promise<StandardResponse> {
    const user = await this.commonService.getLoggedInUser();
    await this.assertStoreOwner(storeId, user.id);

    const groups = await this.optionGroupRepository.find({
      where: { storeId, userId: user.id },
      order: { name: 'ASC' },
    });

    return new StandardResponse(
      false,
      'MENU_OPTION_GROUPS_FETCHED_SUCCESSFULLY',
      groups,
    );
  }

  async update(
    id: string,
    request: MenuOptionGroupRequest,
  ): Promise<StandardResponse> {
    const user = await this.commonService.getLoggedInUser();
    const optionGroup = await this.optionGroupRepository.findOne({
      where: { id, userId: user.id },
    });

    if (!optionGroup) {
      throw new NotFoundException(
        new StandardResponse(true, 'MENU_OPTION_GROUP_NOT_FOUND'),
      );
    }

    const normalizedName = this.normalizeName(request.name);
    await this.assertNameAvailable(
      optionGroup.storeId,
      normalizedName,
      optionGroup.id,
    );
    optionGroup.name = request.name.trim();
    optionGroup.normalizedName = normalizedName;
    optionGroup.isPublished = request.isPublished ?? optionGroup.isPublished;
    optionGroup.isRequired = request.isRequired ?? optionGroup.isRequired;
    optionGroup.allowMultiple =
      request.allowMultiple ?? optionGroup.allowMultiple;
    optionGroup.choices = this.normalizeChoices(
      request.choices ?? optionGroup.choices ?? [],
    );
    this.assertRequiredGroupHasChoices(
      optionGroup.isRequired,
      optionGroup.choices,
    );

    try {
      await this.optionGroupRepository.save(optionGroup);
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new BadRequestException(
          new StandardResponse(true, 'MENU_OPTION_GROUP_NAME_ALREADY_EXISTS'),
        );
      }
      throw error;
    }

    return new StandardResponse(
      false,
      'MENU_OPTION_GROUP_UPDATED_SUCCESSFULLY',
      optionGroup,
    );
  }

  async remove(id: string): Promise<StandardResponse> {
    const user = await this.commonService.getLoggedInUser();
    await this.optionGroupRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(MenuOptionGroup);
      const optionGroup = await repository.findOne({
        where: { id, userId: user.id },
      });

      if (!optionGroup) {
        throw new NotFoundException(
          new StandardResponse(true, 'MENU_OPTION_GROUP_NOT_FOUND'),
        );
      }

      // Keep menu items clean when an option is deleted. This is one indexed,
      // store-scoped update instead of loading and saving every product.
      await manager
        .getRepository(MenuItem)
        .createQueryBuilder()
        .update(MenuItem)
        .set({
          optionGroupIds: () =>
            `COALESCE("optionGroupIds", '[]'::jsonb) - :optionGroupId`,
        })
        .where('"storeId" = :storeId', { storeId: optionGroup.storeId })
        .setParameter('optionGroupId', optionGroup.id)
        .execute();

      await repository.delete(optionGroup.id);
    });

    return new StandardResponse(
      false,
      'MENU_OPTION_GROUP_DELETED_SUCCESSFULLY',
    );
  }

  private async assertStoreOwner(storeId: string, userId: string) {
    const ownsStore = await this.storeService.existingByStoreIdAndVendorId(
      storeId,
      userId,
    );
    if (!ownsStore) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }
  }

  private normalizeName(name: string) {
    return name.trim().toLowerCase();
  }

  private normalizeChoices(
    choices: Array<{ id?: string; name: string; priceAdjustment: number }>,
  ) {
    const normalizedNames = new Set<string>();
    const choiceIds = new Set<string>();
    return choices.map((choice) => {
      const name = choice.name.trim();
      const normalizedName = name.toLowerCase();
      if (!name || normalizedNames.has(normalizedName)) {
        throw new BadRequestException(
          new StandardResponse(
            true,
            !name
              ? 'MENU_OPTION_CHOICE_NAME_REQUIRED'
              : 'MENU_OPTION_CHOICE_NAME_ALREADY_EXISTS',
          ),
        );
      }
      normalizedNames.add(normalizedName);
      const priceAdjustment = Number(choice.priceAdjustment || 0);
      if (!Number.isFinite(priceAdjustment) || priceAdjustment < 0) {
        throw new BadRequestException(
          new StandardResponse(true, 'INVALID_MENU_OPTION_PRICE'),
        );
      }
      const id = choice.id?.trim() || `moc_${uuidv4()}`;
      if (choiceIds.has(id)) {
        throw new BadRequestException(
          new StandardResponse(true, 'MENU_OPTION_CHOICE_ID_ALREADY_EXISTS'),
        );
      }
      choiceIds.add(id);
      return {
        id,
        name,
        priceAdjustment,
      };
    });
  }

  private assertRequiredGroupHasChoices(
    isRequired: boolean,
    choices: unknown[],
  ) {
    if (isRequired && choices.length === 0) {
      throw new BadRequestException(
        new StandardResponse(true, 'REQUIRED_MENU_OPTION_NEEDS_CHOICES'),
      );
    }
  }

  private async assertNameAvailable(
    storeId: string,
    normalizedName: string,
    excludedId?: string,
  ) {
    const duplicate = await this.optionGroupRepository.findOne({
      where: {
        storeId,
        ...(excludedId ? { id: Not(excludedId) } : {}),
        name: Raw((column) => `LOWER(TRIM(${column})) = :normalizedName`, {
          normalizedName,
        }),
      },
    });

    if (duplicate) {
      throw new BadRequestException(
        new StandardResponse(true, 'MENU_OPTION_GROUP_NAME_ALREADY_EXISTS'),
      );
    }
  }
}

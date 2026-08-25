import { MenuItemService } from './menu-item.service';
import { DataSource, EntitySchema } from 'typeorm';

interface SqlTestCategory {
  id: string;
  items: SqlTestMenuItem[];
}

interface SqlTestMenuItem {
  id: string;
  name: string;
  category: SqlTestCategory;
}

const sqlTestCategorySchema = new EntitySchema<SqlTestCategory>({
  name: 'SqlTestCategory',
  columns: {
    id: { type: String, primary: true },
  },
  relations: {
    items: {
      type: 'one-to-many',
      target: 'SqlTestMenuItem',
      inverseSide: 'category',
    },
  },
});

const sqlTestMenuItemSchema = new EntitySchema<SqlTestMenuItem>({
  name: 'SqlTestMenuItem',
  columns: {
    id: { type: String, primary: true },
    name: { type: String },
  },
  relations: {
    category: {
      type: 'many-to-one',
      target: 'SqlTestCategory',
      joinColumn: true,
    },
  },
});

describe('MenuItemService catalogue ordering', () => {
  it('uses case-insensitive name ordering with a stable pagination tie-breaker', async () => {
    const queryBuilder: any = {
      leftJoinAndSelect: jest.fn(),
      where: jest.fn(),
      addSelect: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      skip: jest.fn(),
      take: jest.fn(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    Object.values(queryBuilder).forEach((method: any) => {
      if (method?.mockReturnValue && method !== queryBuilder.getManyAndCount) {
        method.mockReturnValue(queryBuilder);
      }
    });
    const menuItemRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const service = new MenuItemService(
      menuItemRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const pagination = {
      page: 1,
      size: 20,
    } as never;

    await service.getMenuItems('store_1', pagination);

    expect(queryBuilder.addSelect).toHaveBeenCalledWith(
      'LOWER(menuItem.name)',
      'menu_item_name_lower',
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      'menu_item_name_lower',
      'ASC',
    );
    const orderingAlias = queryBuilder.orderBy.mock.calls[0][0] as string;
    expect(orderingAlias).toBe(orderingAlias.toLowerCase());
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('menuItem.id', 'ASC');
  });

  it('generates a PostgreSQL-safe ordering alias for joined pagination', async () => {
    const dataSource = new DataSource({
      type: 'postgres',
      database: 'sql_generation_only',
      entities: [sqlTestCategorySchema, sqlTestMenuItemSchema],
    });
    await (dataSource as any).buildMetadatas();

    const queryBuilder = dataSource
      .getRepository<SqlTestMenuItem>('SqlTestMenuItem')
      .createQueryBuilder('menuItem')
      .leftJoinAndSelect('menuItem.category', 'category')
      .addSelect('LOWER(menuItem.name)', 'menu_item_name_lower')
      .orderBy('menu_item_name_lower', 'ASC')
      .addOrderBy('menuItem.id', 'ASC')
      .skip(0)
      .take(20);

    const sql = queryBuilder.getQuery();
    expect(sql).toContain('LOWER("menuItem"."name") AS "menu_item_name_lower"');
    expect(sql).toContain('ORDER BY menu_item_name_lower ASC');

    const [paginationSelect, paginationOrder] = (
      queryBuilder as any
    ).createOrderByCombinedWithSelectExpression('distinctAlias');
    expect(paginationSelect).toContain(
      '"distinctAlias"."menu_item_name_lower"',
    );
    expect(paginationOrder['"distinctAlias"."menu_item_name_lower"']).toBe(
      'ASC',
    );
  });
});

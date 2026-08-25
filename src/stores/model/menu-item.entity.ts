import {
  Entity,
  Column,
  ManyToOne,
  BeforeInsert,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { MenuCategory } from './menu-category.entity';
import { MenuPack } from './menu-pack.entity';
import { Stores } from './stores.entity';

@Entity()
export class MenuItem {
  @PrimaryColumn()
  id: string;

  @ManyToOne(() => MenuCategory, (menuCategory) => menuCategory.menuItems)
  menuCategory: MenuCategory;

  @Column()
  menuCategoryId: string;

  @ManyToOne(() => MenuPack, (menuPack) => menuPack.menuItems)
  menuPack: MenuPack;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'json', nullable: true })
  images: string[];

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  @Column({ default: true })
  isAvailable: boolean;

  @Column({ default: false })
  isDiscountActive: boolean;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  discountPrice: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  discountPercentage: number;

  @Column({ nullable: true })
  discountStart: Date;

  @Column({ nullable: true })
  discountEnd: Date;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  optionGroupIds: string[];

  @ManyToOne(() => Stores, (store) => store.menuItems, { onDelete: 'CASCADE' })
  store: Stores;

  @Index('IDX_menu_item_store_id')
  @Column()
  storeId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `mit_${uuidv4()}`;
  }
}

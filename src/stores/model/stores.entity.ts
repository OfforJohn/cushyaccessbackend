import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { OpeningSchedule } from './opening-schedule.entity';
import { Users } from '../../users/model/users.entity';
import { UserLocations } from '../../users/model/user-locations.entity';
import { v4 as uuidv4 } from 'uuid';
import { StoreCategory } from './enums/store.category';
import { MenuCategory } from './menu-category.entity';
import { MenuPack } from './menu-pack.entity';
import { MenuItem } from './menu-item.entity';
import { Orders } from '../../orders/model/order.entity';
import { Cart } from 'src/orders/model/cart.entity';
import { MenuOptionGroup } from './menu-option-group.entity';

@Entity()
export class Stores {
  @PrimaryColumn()
  id: string;

  @OneToOne(() => OpeningSchedule, (openingSchedules) => openingSchedules.store)
  openingSchedules: OpeningSchedule;

  @Column()
  userId: string;

  @ManyToOne(() => Users, (user) => user.store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Users;

  @Column({ nullable: true })
  name?: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  coverImage?: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  mobile?: string;

  // Never select or serialize the branch credential in ordinary store reads.
  // Nullable is intentional for branches created before branch passwords were
  // introduced; those stores use the authenticated one-time setup flow.
  @Column({ nullable: true, select: false })
  branchPasswordHash?: string;

  @Column({ type: 'timestamp', nullable: true, select: false })
  branchPasswordUpdatedAt?: Date;

  // API-only flag populated by StoreService. It lets clients route legacy
  // branches into password setup without exposing the hash.
  branchPasswordConfigured?: boolean;

  @Column({ nullable: true })
  addressId?: string;

  @ManyToOne(() => UserLocations, {
    onDelete: 'CASCADE',
  })
  address?: UserLocations;

  @Column({
    type: 'enum',
    enum: StoreCategory,
    default: StoreCategory.RESTAURANT,
  })
  category: StoreCategory;

  @Column({ default: false })
  isVerified: boolean;

  @Column({ default: false })
  isSuspended: boolean;

  @Column({ nullable: true })
  suspensionReason?: string;

  @Column({ nullable: true })
  suspendedBy?: string;

  @Column({ type: 'timestamp', nullable: true })
  suspendedAt?: Date;

  @Column({ nullable: true })
  unsuspendNotes?: string;

  @Column({ type: 'timestamp', nullable: true })
  unsuspendedAt?: Date;

  @Column({ nullable: true })
  unsuspendedBy?: string;

  @Column({ default: true })
  isVisible: boolean;

  @Column({ default: false })
  isFeatured: boolean;

  @Column({ type: 'timestamp', nullable: true })
  featuredAt?: Date | null;

  @OneToMany(() => MenuCategory, (menuCategory) => menuCategory.store)
  menuCategories: MenuCategory[];

  @OneToMany(() => MenuPack, (menuPack) => menuPack.store)
  menuPacks: MenuPack[];

  @OneToMany(() => MenuOptionGroup, (optionGroup) => optionGroup.store)
  menuOptionGroups: MenuOptionGroup[];

  @OneToMany(() => MenuItem, (menuItem) => menuItem.store)
  menuItems: MenuItem[];

  @OneToMany(() => Orders, (orders) => orders.store)
  orders: Orders[];

  @OneToMany(() => Cart, (cart) => cart.store)
  cart: Cart[];

  @BeforeInsert()
  beforeInsert() {
    this.id = `str_${uuidv4()}`;
  }
}

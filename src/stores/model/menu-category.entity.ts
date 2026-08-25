import {
  Entity,
  Column,
  ManyToOne,
  BeforeInsert,
  PrimaryColumn,
  OneToMany,
  Index,
} from 'typeorm';

import { v4 as uuidv4 } from 'uuid';
import { Users } from '../../users/model/users.entity';
import { Stores } from './stores.entity';
import { MenuItem } from './menu-item.entity';

@Entity()
@Index(['storeId', 'normalizedName'], { unique: true })
export class MenuCategory {
  @PrimaryColumn()
  id: string;

  @ManyToOne(() => Users)
  user: Users;

  @Column()
  userId: string;

  @ManyToOne(() => Stores, (store) => store.menuCategories, {
    onDelete: 'CASCADE',
  })
  store: Stores;

  @Column()
  storeId: string;

  @Column()
  name: string;

  // Nullable keeps synchronization safe for historical categories. New and
  // updated categories always receive a normalized per-store uniqueness key.
  @Column({ nullable: true })
  normalizedName?: string;

  @Column({ default: false })
  isPublished: boolean;

  @OneToMany(() => MenuItem, (menuItem) => menuItem.menuCategory)
  menuItems: MenuItem[];

  @BeforeInsert()
  beforeInsert() {
    this.id = `mcg_${uuidv4()}`;
  }
}

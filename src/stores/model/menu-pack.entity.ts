import {
  Entity,
  Column,
  ManyToOne,
  BeforeInsert,
  PrimaryColumn,
  OneToMany,
} from 'typeorm';

import { v4 as uuidv4 } from 'uuid';
import { Users } from '../../users/model/users.entity';
import { Stores } from './stores.entity';
import { MenuItem } from './menu-item.entity';

@Entity()
export class MenuPack {
  @PrimaryColumn()
  id: string;

  @ManyToOne(() => Users)
  user: Users;

  @Column()
  userId: string;

  @ManyToOne(() => Stores, (store) => store.menuPacks, { onDelete: 'CASCADE' })
  store: Stores;

  @Column()
  storeId: string;

  @Column()
  name: string;

  @Column({ default: false })
  isPublished: boolean;

  @OneToMany(() => MenuItem, (menuItem) => menuItem.menuPack)
  menuItems: MenuItem[];

  @BeforeInsert()
  beforeInsert() {
    this.id = `mp_${uuidv4()}`;
  }
}

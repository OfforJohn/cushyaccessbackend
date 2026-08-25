import {
  BeforeInsert,
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Users } from '../../users/model/users.entity';
import { Stores } from './stores.entity';

export type MenuOptionChoice = {
  id: string;
  name: string;
  priceAdjustment: number;
};

@Entity()
@Index(['storeId', 'normalizedName'], { unique: true })
export class MenuOptionGroup {
  @PrimaryColumn()
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  user: Users;

  @Column()
  storeId: string;

  @ManyToOne(() => Stores, (store) => store.menuOptionGroups, {
    onDelete: 'CASCADE',
  })
  store: Stores;

  @Column()
  name: string;

  // Nullable keeps schema synchronization safe for installations that already
  // have option groups; all newly created/updated rows receive a normalized key.
  @Column({ nullable: true })
  normalizedName?: string;

  @Column({ default: true })
  isPublished: boolean;

  @Column({ default: false })
  isRequired: boolean;

  @Column({ default: false })
  allowMultiple: boolean;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  choices: MenuOptionChoice[];

  @BeforeInsert()
  beforeInsert() {
    this.id = `mog_${uuidv4()}`;
  }
}

import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';
import { Users } from '../../users/model/users.entity';
import { Stores } from './stores.entity';

@Entity('favorite_stores')
@Index('UQ_favorite_stores_user_store', ['userId', 'storeId'], {
  unique: true,
})
@Index('IDX_favorite_stores_user_created', ['userId', 'createdAt'])
export class FavoriteStore {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Users;

  @Column()
  storeId: string;

  @ManyToOne(() => Stores, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store: Stores;

  @CreateDateColumn()
  createdAt: Date;
}

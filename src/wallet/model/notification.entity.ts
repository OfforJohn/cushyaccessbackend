import { Users } from '../../users/model/users.entity';
import { v4 as uuidv4 } from 'uuid';
import {
  BeforeInsert,
  PrimaryColumn,
  Column,
  Entity,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Wallets } from './wallet.entity';

@Entity()
export class WalletNotifications {
  @PrimaryColumn()
  id: string;

  @ManyToOne(() => Wallets, (wallet) => wallet.notifications)
  wallet: Wallets;

  @Column()
  walletId: string;

  @ManyToOne(() => Users)
  user: Users;

  @Column()
  userId: string;

  @Column()
  title: string;

  @Column()
  message: string;

  @Column()
  read: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `wn_${uuidv4()}`;
  }
}

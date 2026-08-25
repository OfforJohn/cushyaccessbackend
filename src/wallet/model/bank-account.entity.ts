import { Users } from '../../users/model/users.entity';
import { Wallets } from './wallet.entity';
import { v4 as uuidv4 } from 'uuid';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class BankAccounts {
  @PrimaryColumn()
  id: string;

  @ManyToOne(() => Users)
  user: Users;

  @Column()
  userId: string;

  @ManyToOne(() => Wallets, (wallet) => wallet.bankAccounts)
  wallet: Wallets;

  @Column()
  walletId: string;

  @Column()
  accountName: string;

  @Column()
  accountNumber: string;

  @Column()
  bank: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `ba_${uuidv4()}`;
  }
}

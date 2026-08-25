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
import { Users } from '../../users/model/users.entity';

@Entity()
export class CreditCards {
  @PrimaryColumn()
  id: string;

  @ManyToOne(() => Users)
  user: Users;

  @Column()
  userId: string;

  @ManyToOne(() => Wallets, (wallet) => wallet.creditCards)
  wallet: Wallets;

  @Column()
  walletId: string;

  @Column()
  cardNumber: string;

  @Column()
  exp: string;

  @Column()
  cvv: string;

  @Column()
  pin: string;

  @Column()
  token: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `cc_${uuidv4()}`;
  }
}

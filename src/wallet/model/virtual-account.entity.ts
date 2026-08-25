import { Users } from '../../users/model/users.entity';
import { Wallets } from './wallet.entity';
import { v4 as uuidv4 } from 'uuid';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaystackVirtualAccount } from './dto/paystack-request.dto';

@Entity()
export class VirtualAccounts {
  @PrimaryColumn()
  id: string;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Users;

  @Column()
  userId: string;

  @OneToOne(() => Wallets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'walletId' })
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

  @Column({ nullable: true, type: 'json' })
  mataData: PaystackVirtualAccount;

  @BeforeInsert()
  beforeInsert() {
    this.id = `va_${uuidv4()}`;
  }
}

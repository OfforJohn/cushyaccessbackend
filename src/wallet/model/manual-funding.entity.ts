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
import { ColumnNumericTransformer } from './column-numeric-transformer';

@Entity()
export class ManualFunding {
  @PrimaryColumn()
  id: string;

  @ManyToOne(() => Users)
  user: Users;

  @Column()
  userId: string;

  @ManyToOne(() => Wallets, (wallet) => wallet.manualFundings)
  wallet: Wallets;

  @Column()
  walletId: string;

  @Column(
    'decimal',
    {
      precision: 15,
      scale: 2,
      default: 0,
      transformer: new ColumnNumericTransformer(),
    },
  )
  amount: number;

  @Column()
  description: string;

  @Column({ default: 'SUCCESSFUL' })
  status: 'SUCCESSFUL' | 'PENDING' | 'FAILED' | 'REVERSED';

  @Column('decimal', { precision: 15, scale: 2 })
  oldBalance: number;

  @Column('decimal', { precision: 15, scale: 2 })
  newBalance: number;

  @Column({ default: 'NGN' })
  currency: string;

  @Column()
  transactionReference: string;

  @Column()
  fundedBy: string;

  @Column({ nullable: true })
  fundedById: string;

  @Column({ nullable: true })
  originalReference: string; // For reversals

  @Column({ nullable: true })
  reversalReference: string;

  @Column({ nullable: true })
  reversalReason: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `mf_${uuidv4()}`;
  }
}

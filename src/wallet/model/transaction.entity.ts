import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Wallets } from './wallet.entity';
import { TransactionCategory } from './transaction-category.enum';
import { Users } from '../../users/model/users.entity';
import { v4 as uuidv4 } from 'uuid';
import { TransactionStatus } from './transaction-status.enum';
import { ColumnNumericTransformer } from './column-numeric-transformer';
import { WebHookEvent } from './dto/paystack-response.dto';

@Entity()
export class Transactions {
  @PrimaryColumn()
  id: string;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  user: Users;

  @Column()
  userId: string;

  @Column({ nullable: true })
  senderUserId: string; //if userId = senderUserId, then it is a self transaction

  @Column({ nullable: true })
  senderWalletId: string;

  @ManyToOne(() => Users, { nullable: true, onDelete: 'SET NULL' })
  senderUser: Users;

  @ManyToOne(() => Wallets, { nullable: true, onDelete: 'SET NULL' })
  senderWallet: Wallets;

  @Column({ nullable: true })
  receipientUserId: string;

  @Column({ nullable: true })
  receipientWalletId: string;

  @ManyToOne(() => Users, { nullable: true, onDelete: 'SET NULL' })
  receipientUser: Users;

  @ManyToOne(() => Wallets, { nullable: true, onDelete: 'SET NULL' })
  receipientWallet: Wallets;

  @Column()
  transactionReference: string;

  @Column({ nullable: true })
  thirdPartyTransactionReference: string;

  @ManyToOne(() => Wallets, { nullable: true, onDelete: 'SET NULL' })
  wallet: Wallets;

  @Column({ nullable: true })
  walletId: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
    nullable: true,
  })
  amount: number;

  @Column({
    type: 'enum',
    enum: TransactionCategory,
  })
  category: TransactionCategory;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({ nullable: true })
  description: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ nullable: true })
  userDevice: string;

  @Column({ nullable: true })
  orderId: string;

  @Column({ nullable: true, type: 'json' })
  metaData: WebHookEvent;

  @BeforeInsert()
  beforeInsert() {
    this.id = `trn_${uuidv4()}`;
  }
}

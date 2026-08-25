import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Users } from '../../users/model/users.entity';
import { VirtualAccounts } from './virtual-account.entity';
import { BankAccounts } from './bank-account.entity';
import { CreditCards } from './credit-card.entity';
import { Transactions } from './transaction.entity';
import { v4 as uuidv4 } from 'uuid';
import { WalletNotifications } from './notification.entity';
import { ColumnNumericTransformer } from './column-numeric-transformer';
import { ManualFunding } from './manual-funding.entity';

@Entity()
export class Wallets {
  @PrimaryColumn()
  id: string;

  @OneToOne(() => Users, (user) => user.wallet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Users;

  @Column()
  userId: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: new ColumnNumericTransformer(),
  })
  walletBalance: number;

  @OneToMany(() => Transactions, (transaction) => transaction.wallet)
  transactions: Transactions[];

  @OneToOne(() => VirtualAccounts, (virtualAccount) => virtualAccount.wallet)
  virtualAccount: VirtualAccounts;

  @OneToMany(() => BankAccounts, (bankAccount) => bankAccount.wallet)
  bankAccounts: BankAccounts[];

  @OneToMany(() => CreditCards, (creditCard) => creditCard.wallet)
  creditCards: CreditCards[];

  @OneToMany(() => ManualFunding, (manualFunding) => manualFunding.wallet)
  manualFundings: ManualFunding[];

  @OneToMany(() => WalletNotifications, (notification) => notification.wallet)
  notifications: WalletNotifications[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  pin: string;

  @Column({ default: false })
  hasSetPin: boolean;

  @BeforeInsert()
  beforeInsert() {
    this.id = `wa_${uuidv4()}`;
  }
}

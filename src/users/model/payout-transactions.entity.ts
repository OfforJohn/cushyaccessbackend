import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Users } from 'src/users/model/users.entity';
import { PayoutStatus } from './payout-status.enum';

@Entity()
export class PayoutTransactions {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Users, (user) => user.payoutTransactions)
  vendor: Users;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  amount: number;

  @Column({ nullable: true })
  bankName: string;

  @Column({ nullable: true })
  accountNumber: string;

  @Column({ nullable: true })
  accountName: string;

  @Column({ unique: true })
  reference: string;

  @Column({ nullable: true })
  providerReference?: string;

  @Column({ default: PayoutStatus.PENDING })
  status: PayoutStatus;

  @Column({ nullable: true })
  narration: string;

  @Column('text', { array: true, nullable: true })
  orderIds: string[] | null;

  @Column({ nullable: true })
  remark?: string | null;

  /** Whether this payout's amount was removed from the available wallet balance. */
  @Column({ default: false })
  fundsReserved: boolean;

  @Column({ type: 'timestamp', nullable: true })
  fundsReleasedAt?: Date | null;

  @Column({ nullable: true })
  providerStatus?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastReconciledAt?: Date | null;

  @Column({ default: 0 })
  reconciliationAttempts: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

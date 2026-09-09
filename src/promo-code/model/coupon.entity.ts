import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Users } from 'src/users/model/users.entity';
import { CouponRedemption } from './coupon-redemption.entity';

export enum CouponType {
  PERCENT = 'PERCENT',
  FIXED = 'FIXED',
}
export enum CouponStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}
export enum CouponSource {
  ADMIN = 'ADMIN',
  BIRTHDAY = 'BIRTHDAY',
  REFERRAL = 'REFERRAL',
}

@Entity('coupons')
@Index(['source', 'createdAt'])
@Index(['audienceUserId'])
@Index('IDX_coupons_pending_birthday_email', ['endDate'], {
  where: `"source" = 'BIRTHDAY' AND "birthdayEmailSentAt" IS NULL`,
})
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column({ type: 'enum', enum: CouponType })
  type: CouponType;

  // For PERCENT store decimals (7.5 means 7.5%); for FIXED store as number (currency unit)
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  value: number;

  // 'SITE' for site-wide OR store id string for merchant-specific
  @Column({ type: 'varchar', default: 'SITE' })
  appliesTo: string;

  // optional limits
  @Column({ type: 'int', nullable: true })
  usageLimit: number | null;

  @Column({ type: 'int', default: 0 })
  timesUsed: number;

  @Column({ type: 'timestamp', nullable: true })
  startDate: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  endDate: Date | null;

  @Column({ type: 'enum', enum: CouponStatus, default: CouponStatus.ACTIVE })
  status: CouponStatus;

  @Column({ type: 'enum', enum: CouponSource, default: CouponSource.ADMIN })
  source: CouponSource;

  @Column({ nullable: true })
  audienceUserId: string | null;

  @ManyToOne(() => Users, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'audienceUserId' })
  audienceUser: Users | null;

  @Column({ unique: true, nullable: true })
  campaignKey: string | null;

  @Column({ type: 'timestamp', nullable: true })
  birthdayEmailClaimedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  birthdayEmailSentAt: Date | null;

  @ManyToOne(() => Users, { nullable: true })
  createdBy: Users | null; // admin who created

  @OneToMany(() => CouponRedemption, (redemption) => redemption.coupon)
  redemptions: CouponRedemption[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

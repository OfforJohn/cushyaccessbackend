import { Orders } from 'src/orders/model/order.entity';
import { Users } from 'src/users/model/users.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Coupon } from './coupon.entity';

@Entity('coupon_redemptions')
@Index(['couponId', 'orderId'], { unique: true })
@Index(['userId', 'redeemedAt'])
export class CouponRedemption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  couponId: string;

  @ManyToOne(() => Coupon, (coupon) => coupon.redemptions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'couponId' })
  coupon: Coupon;

  @Column({ nullable: true })
  userId: string | null;

  @ManyToOne(() => Users, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: Users | null;

  @Column()
  orderId: string;

  @ManyToOne(() => Orders, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Orders;

  @CreateDateColumn()
  redeemedAt: Date;
}

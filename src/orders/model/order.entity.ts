import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { UserLocations } from '../../users/model/user-locations.entity';
import { OrderTypes } from './enum/order-types.enum';
import { OrderUser } from './order-user.entity';
import { v4 as uuidv4 } from 'uuid';
import { Users } from '../../users/model/users.entity';
import { OrderItems } from './order-items.entity';
import { OrderCharges } from './charges/order-charges.entity';
import { OrderTracking } from './order-tracking.entity';
import { Stores } from '../../stores/model/stores.entity';
import { Transform } from 'class-transformer';
import { default as moment } from 'moment';
import { OrderStatus } from './enum/order-status.enum';
import { Rider } from '../../riders/model/rider.entity';

@Entity()
@Index(['riderId', 'status'])
@Index(['storeId', 'status'])
@Index(['userId', 'createdAt'])
@Index(['status', 'createdAt'])
export class Orders {
  @PrimaryColumn()
  id: string;

  @Column({ nullable: true })
  userId: string;

  @ManyToOne(() => Users, (user) => user.orders, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: Users;

  @Column({ nullable: true })
  riderId: string;

  @ManyToOne(() => Rider, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'riderId' })
  rider: Rider;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.pending,
  })
  status: OrderStatus;

  @ManyToOne(() => UserLocations, { nullable: true, onDelete: 'SET NULL' })
  pickUpLocation: UserLocations;

  @Column({ nullable: true })
  pickUpLocationId: string;

  @ManyToOne(() => UserLocations, { nullable: true, onDelete: 'SET NULL' })
  dropOffLocation: UserLocations;

  @Column({ nullable: true })
  dropOffLocationId: string;

  @Column({ nullable: true })
  pickUpLocationAddress: string;

  @Column({ nullable: true })
  dropOffLocationAddress: string;

  @Column({ type: 'enum', enum: OrderTypes, default: OrderTypes.q_commerce })
  type: OrderTypes;

  @Column({ nullable: true })
  noteForRider: string;

  @Column({ nullable: true })
  noteForVendor: string;

  @Column({ nullable: true })
  noteForStore: string;

  @Column()
  totalItems: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  totalAmount: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  totalAmountBeforeCharges: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  discountAmount: number;

  @Column({ nullable: true })
  appliedCouponCode: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  Charges: number;

  @Column({ nullable: true })
  pickedUpAt: Date;

  @Column({ nullable: true })
  deliveredAt: Date;

  @Column({ nullable: true })
  cancelledAt: Date;

  @Column({ nullable: true })
  rejectedAt: Date;

  @OneToOne(() => OrderUser, { nullable: true })
  @JoinColumn()
  recipientInfo: OrderUser;

  @OneToOne(() => OrderUser, { nullable: true })
  @JoinColumn()
  senderInfo: OrderUser;

  @OneToOne(() => OrderCharges, (orderCharges) => orderCharges.order)
  orderCharges: OrderCharges;

  // Older deployments created this shadow column when both sides of the
  // one-to-one relation owned a join column. Keep it mapped while schema
  // synchronization is enabled, but use OrderCharges.orderId as the
  // authoritative relationship.
  @Column({ name: 'orderChargesId', nullable: true, select: false })
  legacyOrderChargesId: string;


  @Column({ nullable: true })
  storeId: string;

  @ManyToOne(() => Stores, (stores) => stores.orders, { nullable: true, onDelete: 'SET NULL' })
  store: Stores;

  @Column({ default: false })
  scheduleDelivery: boolean;

  @Transform(
    ({ value }) => (value ? moment(value).format('DD/MM/YYYY') : null),
    { toPlainOnly: true },
  )
  @Column({ nullable: true })
  scheduleDeliveryDate: Date;

  @Column({ nullable: true })
  scheduleDeliveryTime: string;

  @Column({ type: 'jsonb', nullable: true })
  items: string[];

  @OneToMany(() => OrderItems, (orderItems) => orderItems.order)
  orderItems: OrderItems[];

  @OneToMany(() => OrderTracking, (orderTracking) => orderTracking.order)
  orderTracking: OrderTracking[];

  @Column({ nullable: true })
  riderAssignedAt: Date;

  @Column({ nullable: true })
  riderAcceptedAt: Date;

  @Column({ nullable: true })
  riderArrivedAt: Date;

  @Column({ nullable: true })
  rejectionReason: string;

  @Column({ nullable: true })
  estimatedPreparationTime: number;

  @Column({ nullable: true })
  estimatedDeliveryTime: number;

  @Column({ nullable: true })
  expectedDeliveryAt: Date;

  @Column('decimal', { precision: 2, scale: 1, nullable: true })
  customerRating: number;

  @Column({ nullable: true })
  customerFeedback: string;

  @Column('decimal', { precision: 2, scale: 1, nullable: true })
  riderRating: number;

  @Column({ nullable: true })
  riderFeedback: string;

  @Column({ nullable: true })
  buyForFriend: boolean;

  @Column({ nullable: true })
  fullHouseAddress: string;

  @Column({ nullable: true })
  additionalPhoneNumber: string;

  @Column({ nullable: true })
  duration: string;

  @Column({ default: false })
  isPaidOut: boolean;

  @Column({ nullable: true })
  paymentStatus: string;

  @Column({ nullable: true })
  paymentMethod: string;

  @Column({ nullable: true })
  paymentReference: string;

  @Column({ nullable: true })
  paymentPaidAt: Date;

  @Column({ nullable: true })
  pickupCode: string;

  @Column({ nullable: true })
  deliveryCode: string;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;


  @BeforeInsert()
  beforeInsert() {
    this.id = `ord_${uuidv4()}`;
    
    if (!this.status) {
      this.status = OrderStatus.pending;
    }
    
    if (this.totalItems === undefined || this.totalItems === null) {
      this.totalItems = 0;
    }
  }
}

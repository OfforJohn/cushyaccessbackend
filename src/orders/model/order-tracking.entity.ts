import {
  Column,
  Entity,
  PrimaryColumn,
  BeforeInsert,
  JoinColumn,
  Index,
  ManyToOne,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { OrderStatus } from './enum/order-status.enum';
import { Orders } from './order.entity';

@Entity()
@Index(['orderId', 'createdAt'])
export class OrderTracking {
  @PrimaryColumn()
  id: string;

  @Column()
  orderId: string;

  @ManyToOne(() => Orders, (order) => order.orderTracking)
  @JoinColumn()
  order: Orders;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.pending })
  orderStatus: OrderStatus;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `otk_${uuidv4()}`;
  }
}

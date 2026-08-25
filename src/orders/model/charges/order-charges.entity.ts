import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { ChargeNode } from './charge-node.entity';
import { Orders } from '../order.entity';
import { v4 as uuidv4 } from 'uuid';

@Entity()
export class OrderCharges {
  @PrimaryColumn()
  id: string;

  @Column({ nullable: true })
  orderId: string;

  @OneToOne(() => Orders, (order) => order.orderCharges)
  @JoinColumn({ name: 'orderId' })
  order: Orders;

  @OneToMany(() => ChargeNode, (chargeNodes) => chargeNodes.orderCharges)
  chargeNodes: ChargeNode[];

  @BeforeInsert()
  beforeInsert() {
    this.id = `sc_${uuidv4()}`; //only one instance
  }
}

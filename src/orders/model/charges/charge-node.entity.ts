import {
  BeforeInsert,
  Column,
  Entity,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { OrderCharges } from './order-charges.entity';
import { v4 as uuidv4 } from 'uuid';

@Entity()
export class ChargeNode {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  amount: number;

  @Column()
  orderChargesId: string;

  @ManyToOne(() => OrderCharges, (ordercharges) => ordercharges.chargeNodes)
  orderCharges: OrderCharges;

  @BeforeInsert()
  beforeInsert() {
    this.id = `orc_${uuidv4()}`;
  }
}

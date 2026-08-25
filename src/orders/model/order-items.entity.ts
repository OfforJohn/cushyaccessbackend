import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Stores } from '../../stores/model/stores.entity';
import { v4 as uuidv4 } from 'uuid';
import { Orders } from './order.entity';
import { MenuPack } from '../../stores/model/menu-pack.entity';
import { SelectedMenuOptionSnapshot } from '../../stores/model/menu-option-selection';

@Entity()
export class OrderItems {
  @PrimaryColumn()
  id: string;

  @Column()
  menuItemId: string;

  @ManyToOne(() => MenuPack)
  menuPack: MenuPack;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'json', nullable: true })
  images: string[];

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  @Column({ default: true })
  isAvailable: boolean;

  @ManyToOne(() => Stores, (store) => store.menuItems, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  store: Stores;

  @Column({ nullable: true })
  storeId: string;

  @ManyToOne(() => Orders, (order) => order.orderItems)
  order: Orders;

  @Column()
  orderId: string;

  @Column({ default: 1 })
  quantity: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  selectedOptions: SelectedMenuOptionSnapshot[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `oi_${uuidv4()}`;
  }
}

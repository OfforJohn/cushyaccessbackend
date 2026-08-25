import {
  Entity,
  Column,
  ManyToOne,
  PrimaryColumn,
  BeforeInsert,
} from 'typeorm';
import { Cart } from './cart.entity';
import { v4 as uuidv4 } from 'uuid';
import { Stores } from 'src/stores/model/stores.entity';
import { SelectedMenuOptionSnapshot } from '../../stores/model/menu-option-selection';

@Entity('cart_items')
export class CartItem {
  @PrimaryColumn()
  id: string;

  @ManyToOne(() => Cart, (cart) => cart.cartItems, { onDelete: 'CASCADE' })
  cart: Cart;

  @Column()
  menuItemId: string;

  @Column()
  name: string;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  @Column({ default: 1 })
  quantity: number;

  @ManyToOne(() => Stores, (store) => store.menuItems, { onDelete: 'CASCADE' })
  store: Stores;

  @Column({ nullable: true })
  storeId: string;

  @Column({ nullable: true })
  image: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  selectedOptions: SelectedMenuOptionSnapshot[];

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  optionPrice: number;

  @Column({ type: 'text', default: '' })
  configurationKey: string;

  @BeforeInsert()
  beforeInsert() {
    this.id = `ctm_${uuidv4()}`;
  }
}

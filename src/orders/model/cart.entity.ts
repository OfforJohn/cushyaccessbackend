import {
  Entity,
  Column,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  BeforeInsert,
  JoinColumn,
} from 'typeorm';
import { Users } from 'src/users/model/users.entity';
import { CartItem } from './cart-items.entity';
import { v4 as uuidv4 } from 'uuid';
import { Stores } from 'src/stores/model/stores.entity';
import { VehicleType } from './enum/vechicle-type.enum';
import { ColumnNumericTransformer } from '../../wallet/model/column-numeric-transformer';

@Entity('carts')
export class Cart {
  @PrimaryColumn()
  id: string;

  @ManyToOne(() => Users, (user) => user.carts, { onDelete: 'CASCADE' })
  user: Users;

  @Column()
  userId: string;

  @OneToMany(() => CartItem, (cartItem) => cartItem.cart, { cascade: true })
  cartItems: CartItem[];

  @Column({ nullable: true })
  noteForRider: string;

  @Column({ nullable: true })
  noteForVendor: string;

  @Column({ nullable: true })
  pickUpLocationId: string;

  @Column({ nullable: true })
  dropOffLocationId: string;

  @Column({ default: VehicleType.bike })
  vechicleType: VehicleType;

  @ManyToOne(() => Stores, (stores) => stores.cart, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'storeId' })
  store: Stores;

  @Column({ nullable: true })
  storeId: string;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: new ColumnNumericTransformer(),
  })
  totalAmount: number;

  @Column({ nullable: true })
  appliedCouponCode: string;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: new ColumnNumericTransformer(),
  })
  discountAmount: number;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: new ColumnNumericTransformer(),
  })
  subtotalBeforeDiscount: number;

  @BeforeInsert()
  beforeInsert() {
    this.id = `cart_${uuidv4()}`;
  }
}

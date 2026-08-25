import {
  BeforeInsert,
  Column,
  Entity,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { Charges } from './charge-entity';

@Entity()
export class AppLevelCharges {
  @PrimaryColumn()
  id: string;

  @Column()
  deliveryFeePerKmForBike: number = 200; // distance

  @Column()
  deliveryFeePerKmForVan: number = 600; // distance

  @OneToMany(() => Charges, (charges) => charges.appLevelCharges)
  charges: Charges[];

  @BeforeInsert()
  beforeInsert() {
    this.id = `sc_cushy_access`; //only one instance
  }
}

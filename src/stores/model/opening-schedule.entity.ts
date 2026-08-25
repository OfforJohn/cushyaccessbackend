import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { DeliveryType } from './enums/delivery-type.enum';
import { v4 as uuidv4 } from 'uuid';
import { Stores } from './stores.entity';
import { Users } from '../../users/model/users.entity';
import { DaySchedule } from './day-schedules';

@Entity()
export class OpeningSchedule {
  @PrimaryColumn()
  id: string;

  @Column()
  storeId: string;

  @OneToOne(() => Stores, (store) => store.openingSchedules, {
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'storeId' })
  store: Stores;

  @Column()
  userId: string;

  @ManyToOne(() => Users, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'userId' })
  user: Users;

  @OneToMany(() => DaySchedule, (daySchedule) => daySchedule.openingSchedule)
  schedules: DaySchedule[];

  @Column({ type: 'enum', enum: DeliveryType, default: DeliveryType.DELIVERY })
  deliveryType: DeliveryType;

  @BeforeInsert()
  beforeInsert() {
    this.id = `os_${uuidv4()}`;
  }
}

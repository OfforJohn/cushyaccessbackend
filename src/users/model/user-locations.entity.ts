import {
  BeforeInsert,
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { Users } from './users.entity';
import { v4 as uuidv4 } from 'uuid';

@Entity()
export class UserLocations {
  @PrimaryColumn()
  id: string;

  @Column()
  country: string;

  @Column()
  state: string;

  @Index('IDX_user_locations_city')
  @Column({ nullable: true })
  city?: string;

  @Column()
  address: string;

  @Column({ nullable: true })
  landMark?: string;

  @Column()
  addedBy: string; // admin_id

  @Column({ nullable: true })
  latitude: string;

  @Column({ nullable: true })
  longitude: string;

  @Column({ nullable: true })
  placeId?: string;

  @OneToMany(() => Users, (users) => users.location, { onDelete: 'CASCADE' })
  users: Users[];

  @Column({ type: 'boolean', default: true })
  isSupported: boolean;

  @BeforeInsert()
  beforeInsert() {
    this.id = `ul_${uuidv4()}`;
  }
}

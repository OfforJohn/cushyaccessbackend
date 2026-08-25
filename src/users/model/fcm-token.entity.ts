import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Users } from './users.entity';

@Entity()
export class FCMToken {
  @PrimaryColumn()
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => Users, (user) => user.fcmTokens, { onDelete: 'CASCADE' })
  user: Users;

  @Column()
  deviceName: string;

  @Column()
  token: string;

  @Column({ nullable: true })
  expoToken?: string;

  @Column({ nullable: true })
  fcmToken?: string;

  @Column({ default: false })
  isDisabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `fcmt_${uuidv4()}`;
  }
}

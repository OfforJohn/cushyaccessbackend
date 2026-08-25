import { Users } from 'src/users/model/users.entity';
import { OnboardingType } from './stage.enum';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
@Entity()
export class Onboarding {
  @PrimaryColumn()
  id: string;

  @Column({ type: 'enum', enum: OnboardingType })
  onboardingType: OnboardingType;

  @ManyToOne(() => Users, (user) => user.onboardings, { onDelete: 'CASCADE' })
  user: Users;

  @Column()
  userId: string;

  @CreateDateColumn()
  dateCreated: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `obd_${uuidv4()}`;
  }
}

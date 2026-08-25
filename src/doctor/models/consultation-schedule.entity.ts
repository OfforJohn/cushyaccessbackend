import { Users } from 'src/users/model/users.entity';
import {
  Entity,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  PrimaryColumn,
  JoinColumn,
  BeforeInsert,
  ManyToOne,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ConsultationType } from './enums/consultation-type.enum';
import { DayOfWeek } from './enums/day-of-week.enum';

@Entity('consultation_schedules')
export class ConsultationSchedule {
  @PrimaryColumn()
  id: string;

  @Column()
  doctorId: string;

  @ManyToOne(() => Users, (user) => user.consultationSchedules, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'doctorId' })
  user: Users;

  @Column({
    type: 'enum',
    enum: ConsultationType,
  })
  consultationType: ConsultationType;

  @Column({
    type: 'enum',
    enum: DayOfWeek,
  })
  day: DayOfWeek;

  @Column({ type: 'time', nullable: true })
  openTime: string | null;

  @Column({ type: 'time', nullable: true })
  closeTime: string | null;

  @Column({ default: false })
  isDayOff: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `cs_${uuidv4()}`;
  }
}

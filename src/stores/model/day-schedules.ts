import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { ScheduleTime } from './enums/schedule-time.enum';
import { OpeningSchedule } from './opening-schedule.entity';
import { Days } from './enums/days.enum';

@Entity()
export class DaySchedule {
  @PrimaryColumn()
  id: string;

  @Column({ type: 'enum', enum: Days })
  day: Days;

  @Column({ type: 'enum', enum: ScheduleTime })
  openTime: ScheduleTime;

  @Column({ type: 'enum', enum: ScheduleTime })
  closeTime: ScheduleTime;

  @Column({ default: false })
  isClosed: boolean;

  @ManyToOne(
    () => OpeningSchedule,
    (openingSchedule) => openingSchedule.schedules,
  )
  @JoinColumn({ name: 'openingScheduleId' })
  openingSchedule: OpeningSchedule;

  @Column()
  openingScheduleId: string;

  @BeforeInsert()
  beforeInsert() {
    this.id = `ds_${this.day}_${this.openingScheduleId}`;
  }
}

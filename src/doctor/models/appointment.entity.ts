import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { ConsultationType } from './enums/consultation-type.enum';
import { DayOfWeek } from './enums/day-of-week.enum';
import { v4 as uuidv4 } from 'uuid';
import { ConsultationStatus } from './enums/consultation-status.enum';
import { Users } from 'src/users/model/users.entity';
import { Prescription } from './prescription.entity';

@Entity('appointments')
export class Appointment {
  @PrimaryColumn()
  id: string;

  @Column()
  doctorId: string;

  @Column()
  patientId: string;

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

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  consultationAmount: number;

  @Column({ type: 'date', nullable: true }) // Add nullable: true for existing data
  date: string; // Format: YYYY-MM-DD

  @Column({ type: 'time' })
  startTime: string;

  @Column({ type: 'time' })
  endTime: string;

  @Column({
    type: 'enum',
    enum: ConsultationStatus,
    default: ConsultationStatus.BOOKED,
  })
  status: ConsultationStatus;

  @Column({ default: false })
  reminder24hSent: boolean;

  @Column({ default: false })
  reminder1hSent: boolean;

  @Column({ default: false })
  reminder15mSent: boolean;

  @Column({ default: false })
  reminderStartSent: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastReminderSentAt: Date;

  @Column({ name: 'meeting_link', nullable: true })
  meetingLink: string;

  @Column({ name: 'doctor_meeting_link', nullable: true })
  doctorMeetingLink: string;

  @Column({ name: 'patient_meeting_link', nullable: true })
  patientMeetingLink: string;

  @Column({ name: 'room_name', nullable: true })
  roomName: string;

  @Column({ name: 'meeting_provider', default: '8x8' })
  meetingProvider: string; // '8x8' or 'jitsi'

  @Column({ name: 'doctor_name', nullable: true })
  doctorName: string;

  @Column({ name: 'patient_name', nullable: true })
  patientName: string;

  @OneToMany(() => Prescription, (prescription) => prescription.patient)
  prescriptions: Prescription[];

  @Column({ default: false })
  isPaidOut: boolean;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  acceptedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  // Add relations for easier querying
  @ManyToOne(() => Users)
  @JoinColumn({ name: 'patientId' })
  patient: Users;

  @ManyToOne(() => Users)
  @JoinColumn({ name: 'doctorId' })
  doctor: Users;

  @BeforeInsert()
  beforeInsert() {
    this.id = `apt_${uuidv4()}`;
  }
}

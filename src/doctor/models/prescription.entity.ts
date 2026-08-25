import { Users } from 'src/users/model/users.entity';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Appointment } from './appointment.entity';

@Entity()
export class Prescription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Appointment, (appointment) => appointment.prescriptions)
  appointment: Appointment;

  @Column()
  appointmentId: string;

  @Column('uuid')
  doctorId: string;

  @Column('uuid')
  patientId: string;

  @Column({ nullable: true })
  diagnosis: string;

  @Column('json') // Better for structured medication data
  medications: {
    name: string;
    dosage: string;
    frequency: string;
    duration?: string;
    instructions?: string;
  }[];

  @Column({ nullable: true })
  notes: string;

  @Column({ nullable: true })
  signatureUrl: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  prescribedDate: Date;

  @ManyToOne(() => Users, { nullable: false })
  @JoinColumn({ name: 'patientId' })
  patient: Users;

  @ManyToOne(() => Users, { nullable: false })
  @JoinColumn({ name: 'doctorId' })
  doctor: Users;
}

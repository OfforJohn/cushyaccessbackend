import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Users } from 'src/users/model/users.entity';
import { ApprovalStatus } from './enums/approval-status.enum';

@Entity()
export class ProfessionDetails {
  @PrimaryColumn()
  id: string;

  @Column()
  userId: string;

  @OneToOne(() => Users, (user) => user.professionDetails, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: Users;

  @Column()
  medicalLicenseNumber: string;

  @Column({ nullable: true })
  specialty: string;

  @Column()
  highestQualification: string;

  @Column({ default: 0 })
  yearOfExperience: number;

  @Column()
  medicalInstitution: string;

  @Column()
  languageSpoken: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: true, default: 4500 })
  consultationFee: number;

  @Column({ nullable: true })
  professionalBio: string;

  @Column()
  medicalLicense: string;

  @Column()
  governmentId: string;

  @Column({ nullable: true })
  professionalCertificate: string;

  @Column({
    type: 'enum',
    enum: ApprovalStatus,
    default: ApprovalStatus.PENDING,
  })
  approvalStatus: ApprovalStatus;

  @Column({ default: true })
  isAvailable: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `prf_${uuidv4()}`;
  }
}

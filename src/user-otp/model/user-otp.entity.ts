import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { OtpType } from './otp-type.enum';
import { OtpPurpose } from './otp-purpose.enum';

@Entity()
@Index('IDX_user_otp_lookup', [
  'userId',
  'otpType',
  'purpose',
  'reference',
  'isActive',
])
export class UserOtp {
  @PrimaryColumn()
  id: string;

  @Column()
  otp: string;

  @Column()
  userId: string;

  @Column()
  reference: string;

  @Column({ type: 'enum', enum: OtpType })
  otpType: OtpType;

  @Column({ type: 'varchar', default: OtpPurpose.VERIFICATION })
  purpose: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  used: boolean;

  @Column({ default: 0 })
  failedAttempts: number;

  @CreateDateColumn()
  dateCreated: Date;

  @Column()
  expiryDate: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `otp_${uuidv4()}`;
  }
}

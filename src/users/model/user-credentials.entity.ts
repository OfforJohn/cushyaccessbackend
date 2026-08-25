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
import { Users } from './users.entity';
import { v4 as uuidv4 } from 'uuid';
import { UserCredentialStatus } from './user-credential.enum';
import { StoreCategory } from '../../stores/model/enums/store.category';

@Entity()
export class UserCredentials {
  @PrimaryColumn()
  id: string;

  @Column({ nullable: true })
  governmentId: string;

  @Column({ nullable: true })
  bvn: string;

  @Column()
  cacURL: string; //image URL for the CAC document

  @Column()
  proofOfAddressURL: string; //image URL for the proof of address document

  @Column({ nullable: true })
  pharmacyLicenseURL: string; //image URL for the pharmacy license document

  @Column({ nullable: true }) // Allow nulls so Postgres won't complain about empty rows
  userId: string;

  @Column({ default: UserCredentialStatus.PENDING })
  status: UserCredentialStatus; // e.g., 'PENDING', 'APPROVED', 'REJECTED'

  @Column({ nullable: true })
  reason: string; // Optional reason for rejection

  @Column()
  vendorCategory: StoreCategory; // e.g., 'PHARMACY', 'HOSPITAL', etc.

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `cred_${uuidv4()}`;
  }
}

// src/riders/model/rider.entity.ts
import {
  Entity,
  Column,
  PrimaryColumn,
  BeforeInsert,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Users } from '../../users/model/users.entity';
import { RiderDocument } from './rider-document.entity';

export enum RiderStatus {
  PENDING = 'pending',
  DOCUMENT_VERIFICATION = 'document_verification',
  BACKGROUND_CHECK = 'background_check',
  TRAINING = 'training',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  INACTIVE = 'inactive',
  REJECTED = 'rejected',
}

export enum PayoutSchedule {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  MANUAL = 'manual',
}

export enum BikeType {
  MOTORCYCLE = 'motorcycle',
  SCOOTER = 'scooter',
  ELECTRIC_BIKE = 'electric_bike',
  BICYCLE = 'bicycle',
}

@Entity('riders')
export class Rider {
  @PrimaryColumn()
  id: string;

  @Column()
  userId: string;

  @OneToOne(() => Users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Users;

  @Column({
    type: 'enum',
    enum: RiderStatus,
    default: RiderStatus.PENDING,
  })
  status: RiderStatus;

  // Bike specific fields
  @Column({
    type: 'enum',
    enum: BikeType,
    nullable: true,
  })
  bikeType: BikeType;

  @Column({ nullable: true })
  bikeBrand: string; // e.g., Honda, Yamaha, Bajaj

  @Column({ nullable: true })
  bikeModel: string;

  @Column({ nullable: true })
  bikeColor: string;

  @Column({ nullable: true })
  bikeYear: number;

  @Column({ nullable: true })
  licensePlate: string; // Vehicle registration number

  @Column({ nullable: true })
  engineDisplacement: string; // e.g., "150cc", "200cc"

  @Column({ default: false })
  hasHelmet: boolean;

  @Column({ default: false })
  hasPhoneMount: boolean;

  @Column({ default: false })
  hasDeliveryBag: boolean;

  @Column({ nullable: true })
  deliveryBagPhoto: string;

  // License information
  @Column({ nullable: true })
  licenseNumber: string;

  @Column({ nullable: true })
  licenseClass: string; // e.g., "A", "B", etc.

  @Column({ nullable: true })
  licenseExpiryDate: Date;

  @Column({ nullable: true })
  licenseIssuingAuthority: string;

  // Rider stats
  @Column({ type: 'decimal', precision: 2, scale: 1, default: 5.0 })
  rating: number;

  @Column({ default: 0 })
  totalDeliveries: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalEarnings: number;

  @Column({ default: 0 })
  acceptanceRate: number;

  @Column({ default: 0 })
  completionRate: number;

  @Column({ default: 0 })
  onlineHours: number; // Total hours online

  // Online/Offline status
  @Column({ default: false })
  isOnline: boolean;

  @Column({ type: 'double precision', nullable: true })
  currentLatitude: number;

  @Column({ type: 'double precision', nullable: true })
  currentLongitude: number;

  @Column({ nullable: true })
  currentLocation: string;

  @Column({ nullable: true })
  lastLocationUpdate: Date;

  @Column({ type: 'jsonb', default: ['food', 'grocery', 'medicine'] })
  activeCategories: string[];

  // Verification status
  @Column({ nullable: true })
  profilePhoto: string;

  @Column({ nullable: true })
  idCardNumber: string;

  @Column({ nullable: true })
  backgroundCheckStatus: string;

  @Column({ nullable: true })
  backgroundCheckCompletedAt: Date;

  @Column({ nullable: true })
  trainingCompleted: boolean;

  @Column({ nullable: true })
  trainingCompletedAt: Date;

  // Insurance
  @Column({ nullable: true })
  insuranceProvider: string;

  @Column({ nullable: true })
  insurancePolicyNumber: string;

  @Column({ nullable: true })
  insuranceExpiryDate: Date;

  // Bank details (simplified)
  @Column({ nullable: true })
  bankName: string;

  @Column({ nullable: true })
  accountNumber: string;

  @Column({ nullable: true })
  accountHolderName: string;

  @Column({ nullable: true })
  bankCode: string; // For transfers

  @Column({ default: false })
  bankDetailsVerified: boolean;

  @Column({ nullable: true })
  recipientCode: string;

  // Emergency contact
  @Column({ nullable: true })
  emergencyContactName: string;

  @Column({ nullable: true })
  emergencyContactPhone: string;

  @Column({ nullable: true })
  emergencyContactRelation: string;

  // Metadata
  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any>;

  @Column({ nullable: true })
  rejectedReason: string;

  @Column({ nullable: true })
  approvedBy: string; // Admin user ID

  @Column({ nullable: true })
  approvedAt: Date;

  @Column({
    type: 'enum',
    enum: PayoutSchedule,
    default: PayoutSchedule.WEEKLY,
  })
  payoutSchedule: PayoutSchedule;

  @OneToMany(() => RiderDocument, (document) => document.rider, {
    cascade: true,
  })
  documents: RiderDocument[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `rider_${uuidv4()}`;
  }
}

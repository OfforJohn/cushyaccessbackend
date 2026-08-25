import {
  Entity,
  Column,
  PrimaryColumn,
  BeforeInsert,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Rider } from './rider.entity';

export enum DocumentType {
  PROFILE_PHOTO = 'profile_photo',
  ID_CARD = 'id_card',
  DRIVING_LICENSE = 'driving_license',
  BIKE_REGISTRATION = 'bike_registration',
  INSURANCE = 'insurance',
  DELIVERY_BAG = 'delivery_bag',
  HELMET = 'helmet',
  BACKGROUND_CONSENT = 'background_consent',
}

export enum DocumentStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

@Entity('rider_documents')
export class RiderDocument {
  @PrimaryColumn()
  id: string;

  @Column()
  riderId: string;

  @ManyToOne(() => Rider, (rider) => rider.documents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'riderId' })
  rider: Rider;

  @Column({
    type: 'enum',
    enum: DocumentType,
  })
  documentType: DocumentType;

  @Column({
    type: 'enum',
    enum: DocumentStatus,
    default: DocumentStatus.PENDING,
  })
  status: DocumentStatus;

  @Column()
  documentUrl: string;

  @Column({ nullable: true })
  documentNumber: string;  // For ID cards, license numbers

  @Column({ nullable: true })
  expiryDate: Date;  // For documents that expire

  @Column({ nullable: true })
  verificationNotes: string;

  @Column({ nullable: true })
  verifiedBy: string;

  @Column({ nullable: true })
  verifiedAt: Date;

  @CreateDateColumn()
  uploadedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `rider_doc_${uuidv4()}`;
  }
}
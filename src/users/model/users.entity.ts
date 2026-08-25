import { Onboarding } from 'src/onboarding/model/onboarding.entity';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { UserRoles } from './user-roles.enum';
import { AdminRole } from './admin-roles.enum';
import { UserLocations } from './user-locations.entity';
import { Stores } from '../../stores/model/stores.entity';
import { Wallets } from '../../wallet/model/wallet.entity';
import { Orders } from '../../orders/model/order.entity';
import { Cart } from 'src/orders/model/cart.entity';
import { FCMToken } from './fcm-token.entity';
import { VendorPayoutDetails } from './vendor-payout.entity';
import { PayoutTransactions } from './payout-transactions.entity';
import { ProfessionDetails } from 'src/doctor/models/professional-details.entity';
import { ConsultationSchedule } from 'src/doctor/models/consultation-schedule.entity';
import { Prescription } from 'src/doctor/models/prescription.entity';
import { UserCredentialStatus } from './user-credential.enum';

@Entity()
@Index('IDX_users_userRole_dateOfBirth', ['userRole', 'dateOfBirth'], {
  where: '"dateOfBirth" IS NOT NULL',
})
export class Users {
  @PrimaryColumn()
  id: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column({ type: 'date', nullable: true })
  dateOfBirth: string | null;

  @Column({ type: 'int', default: 0 })
  dateOfBirthUpdateCount: number;

  @Column({ type: 'int', nullable: true })
  dateOfBirthUpdateYear: number | null;

  @Column({ type: 'timestamp', nullable: true })
  dateOfBirthUpdatedAt: Date | null;

  @Index('IDX_users_email')
  @Column()
  email: string;

  @Column({ nullable: true })
  password: string;

  @Column({ type: 'int', default: 0 })
  sessionVersion: number;

  @Index('IDX_users_mobile')
  @Column()
  mobile: string;

  @Column({ default: false })
  completedOnboarding: boolean;

  @Column({ type: 'enum', enum: UserRoles, default: UserRoles.CUSTOMER })
  userRole: UserRoles;

  @Column({ type: 'enum', enum: AdminRole, nullable: true, default: null })
  adminRole: AdminRole;

  @OneToMany(() => Onboarding, (onboarding) => onboarding.user)
  onboardings: Onboarding[];

  @ManyToOne(() => UserLocations, (locations) => locations.users, {
    onDelete: 'CASCADE',
  })
  location: UserLocations;

  @Column({ nullable: true })
  locationId: string;

  @OneToOne(
    () => ProfessionDetails,
    (professionDetails) => professionDetails.user,
    { nullable: true, onDelete: 'CASCADE' },
  )
  professionDetails: ProfessionDetails;

  @OneToMany(
    () => ConsultationSchedule,
    (consultationSchedule) => consultationSchedule.user,
  )
  consultationSchedules: ConsultationSchedule[];

  @OneToMany(() => Stores, (store) => store.user, {
    onDelete: 'CASCADE',
  })
  store: Stores;

  @Column({ default: '234' })
  callingCode: string;

  @Column({ default: 'NG' })
  countryCode: string;

  @Column({ default: false })
  isVerified: boolean;

  @OneToOne(() => Wallets, (wallet) => wallet.user, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  wallet: Wallets;

  @OneToMany(() => Orders, (orders) => orders.user, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  orders: Orders[];

  @OneToMany(() => Cart, (cart) => cart.user)
  carts: Cart[];

  @OneToMany(() => Prescription, (prescription) => prescription.patient)
  prescriptions: Prescription[];

  @OneToMany(() => Prescription, (prescription) => prescription.doctor)
  prescriptionsWritten: Prescription[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  promoCode: string;

  @OneToMany(() => FCMToken, (fcmToken) => fcmToken.user, {
    onDelete: 'CASCADE',
  })
  fcmTokens: FCMToken[];

  @Column({ nullable: true })
  profilePic: string;

  @Column({ nullable: true })
  username: string;

  @Column({ nullable: true })
  businessName: string;

  @Column({ nullable: true })
  businessRegistration: string;

  @Column({ nullable: true })
  governmentId: string;

  @Column({ nullable: true })
  taxIdentification: string;

  @Column({
    type: 'enum',
    enum: UserCredentialStatus,
    default: UserCredentialStatus.PENDING,
  })
  verificationStatus: UserCredentialStatus;

  @Column({ nullable: true })
  verificationReason: string;

  @OneToOne(() => VendorPayoutDetails, (details) => details.user, {
    nullable: true,
    cascade: true,
  })
  payoutDetails?: VendorPayoutDetails;

  @OneToMany(() => PayoutTransactions, (payout) => payout.vendor, {
    nullable: true,
  })
  payoutTransactions?: PayoutTransactions[];

  @BeforeInsert()
  beforeInsert() {
    this.id = `usr_${uuidv4()}`;
  }
}

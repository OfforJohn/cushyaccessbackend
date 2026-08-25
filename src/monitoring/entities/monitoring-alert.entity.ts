import {
  Entity,
  Column,
  PrimaryColumn,
  BeforeInsert,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AlertType } from '../enums/alert-type.enum';
import { AlertSeverity } from '../enums/alert-severity.enum';
import { AlertStatus } from '../enums/alert-status.enum';

@Entity()
@Index(['type', 'status'])
@Index(['severity', 'status'])
@Index(['createdAt'])
export class MonitoringAlert {
  @PrimaryColumn()
  id: string;

  @Column({
    type: 'enum',
    enum: AlertType,
  })
  type: AlertType;

  @Column({
    type: 'enum',
    enum: AlertSeverity,
    default: AlertSeverity.MEDIUM,
  })
  severity: AlertSeverity;

  @Column({
    type: 'enum',
    enum: AlertStatus,
    default: AlertStatus.ACTIVE,
  })
  status: AlertStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  message: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  thresholdValue: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  currentValue: number;

  @Column({ type: 'jsonb', nullable: true })
  notificationChannels: string[];

  @Column({ nullable: true })
  acknowledgedBy: string;

  @Column({ nullable: true })
  acknowledgedAt: Date;

  @Column({ nullable: true })
  resolvedBy: string;

  @Column({ nullable: true })
  resolvedAt: Date;

  @Column({ type: 'text', nullable: true })
  resolutionNotes: string;

  @Column({ default: 0 })
  occurrenceCount: number;

  @Column({ nullable: true })
  lastOccurredAt: Date;

  @Column({ nullable: true })
  snoozedUntil: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `alert_${uuidv4()}`;
    this.lastOccurredAt = new Date();
    this.occurrenceCount = 1;
  }
}
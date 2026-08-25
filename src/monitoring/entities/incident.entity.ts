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
import { IncidentStatus } from '../enums/incident-status.enum';
import { IncidentPriority } from '../enums/incident-priority.enum';

@Entity()
@Index(['status', 'priority'])
@Index(['createdAt'])
export class Incident {
  @PrimaryColumn()
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: IncidentStatus,
    default: IncidentStatus.DETECTED,
  })
  status: IncidentStatus;

  @Column({
    type: 'enum',
    enum: IncidentPriority,
    default: IncidentPriority.MEDIUM,
  })
  priority: IncidentPriority;

  @Column({ nullable: true })
  assignedTo: string;

  @Column({ nullable: true })
  assignedAt: Date;

  @Column({ nullable: true })
  resolvedBy: string;

  @Column({ nullable: true })
  resolvedAt: Date;

  @Column({ type: 'text', nullable: true })
  resolution: string;

  @Column({ type: 'jsonb', nullable: true })
  affectedServices: string[];

  @Column({ type: 'jsonb', nullable: true })
  rootCause: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  timeline: Array<{
    timestamp: Date;
    action: string;
    performedBy: string;
    notes?: string;
  }>;

  @Column({ type: 'text', nullable: true })
  postMortemNotes: string;

  @Column({ type: 'jsonb', nullable: true })
  relatedAlertIds: string[];

  @Column({ type: 'jsonb', nullable: true })
  tags: string[];

  @Column({ nullable: true })
  estimatedResolutionTime: Date;

  @Column({ nullable: true })
  actualResolutionTime: Date;

  @Column({ type: 'decimal', precision: 3, scale: 1, nullable: true })
  customerImpact: number;

  @Column({ nullable: true })
  detectedBy: string;

  @Column({ nullable: true })
  detectingSystem: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `incident_${uuidv4()}`;
  }
}
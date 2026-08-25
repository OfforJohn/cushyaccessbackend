import {
  Entity,
  Column,
  PrimaryColumn,
  BeforeInsert,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

@Entity()
@Index(['metricName', 'timestamp'])
@Index(['timestamp'])
export class OperationalMetric {
  @PrimaryColumn()
  id: string;

  @Column()
  metricName: string;

  @Column({ type: 'decimal', precision: 15, scale: 4 })
  value: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  unit: string;

  @Column()
  timestamp: Date;

  @Column({ nullable: true })
  category: string;

  @Column({ nullable: true })
  region: string;

  @Column({ nullable: true })
  storeId: string;

  @Column({ nullable: true })
  riderId: string;

  @CreateDateColumn()
  createdAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `op_metric_${uuidv4()}`;
    if (!this.timestamp) {
      this.timestamp = new Date();
    }
  }
}
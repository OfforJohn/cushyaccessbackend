// analytics/entities/analytics.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('analytics')
@Index(['date', 'metricType'])
export class Analytics {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'date' })
  date: Date;

  @Column({
    type: 'enum',
    enum: [
      'new_users',
      'returning_users',
      'active_users',
      'orders',
      'revenue',
      'churned_users',
    ],
  })
  metricType: string;

  @Column({ type: 'int', default: 0 })
  value: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
// analytics/entities/user-activity.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Users } from '../../users/model/users.entity';

@Entity('user_activities')
@Index(['userId', 'activityType', 'createdAt'])
export class UserActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Users;

  @Column({
    type: 'enum',
    enum: [
      'login',
      'order_placed',
      'store_created',
      'menu_viewed',
      'notification_opened',
      'notification_received',
      'rider_order_issue',
    ],
  })
  activityType: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}

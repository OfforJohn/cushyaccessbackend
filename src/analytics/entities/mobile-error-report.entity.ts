import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Users } from '../../users/model/users.entity';

@Entity('mobile_error_reports')
@Index(['userId', 'createdAt'])
@Index(['release', 'createdAt'])
export class MobileErrorReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Users;

  @Column({ length: 500 })
  message: string;

  @Column({ type: 'text', nullable: true })
  stack?: string;

  @Column({ type: 'text', nullable: true })
  componentStack?: string;

  @Column({ default: false })
  fatal: boolean;

  @Column({ length: 16 })
  platform: string;

  @Column({ length: 200, nullable: true })
  route?: string;

  @Column({ length: 100, nullable: true })
  release?: string;

  @Column({ length: 100, nullable: true })
  updateId?: string;

  @Column({ length: 100, nullable: true })
  runtimeVersion?: string;

  @CreateDateColumn()
  createdAt: Date;
}

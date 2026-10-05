import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

@Entity('ai_usage_metrics')
@Index(['provider', 'createdAt'])
export class AiUsageMetric {
  @PrimaryColumn()
  id: string = `ai-metric_${uuidv4()}`;

  @Column()
  provider: string; // 'gemini' or 'bedrock'

  @Column({ name: 'user_id', nullable: true })
  userId?: string;

  @Column({ name: 'chat_id', nullable: true })
  chatId?: string;

  @Column({ name: 'request_count', default: 1 })
  requestCount: number;

  @Column({ name: 'token_count', default: 0 })
  tokenCount: number;

  @Column({ name: 'error_count', default: 0 })
  errorCount: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  cost: number;

  @Column({ name: 'response_time', type: 'int', default: 0 })
  responseTime: number; // in milliseconds

  @Column({ name: 'request_message', type: 'text', nullable: true })
  requestMessage?: string;

  @Column({ name: 'response_message', type: 'text', nullable: true })
  responseMessage?: string;

  @Column({ name: 'is_test', default: false })
  isTest: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

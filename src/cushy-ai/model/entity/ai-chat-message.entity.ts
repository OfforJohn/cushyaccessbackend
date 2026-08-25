import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AiComponent } from '../ai.types';
import { AiChat } from './ai-chat.entity';

export enum AiChatMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

@Entity('ai_chat_messages')
@Index(['chatId', 'createdAt'])
@Index(['chatId', 'clientMessageId'], { unique: true })
export class AiChatMessage {
  @PrimaryColumn()
  id: string = `ai-msg_${uuidv4()}`;

  @Column()
  chatId: string;

  @ManyToOne(() => AiChat, (chat) => chat.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chatId' })
  chat: AiChat;

  @Column({ type: 'enum', enum: AiChatMessageRole })
  role: AiChatMessageRole;

  @Column('text')
  content: string;

  @Column({ nullable: true, length: 100 })
  clientMessageId?: string | null;

  @Column({ nullable: true })
  @Index()
  replyToMessageId?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  components?: AiComponent[] | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}

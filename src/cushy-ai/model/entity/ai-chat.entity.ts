import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AiChatMessage } from './ai-chat-message.entity';

@Entity('ai_chats')
@Index(['userId', 'updatedAt'])
export class AiChat {
  @PrimaryColumn()
  id: string = `ai-chat_${uuidv4()}`;

  @Column()
  @Index()
  userId: string;

  @Column({ length: 120 })
  title: string;

  @Column({ type: 'timestamp', nullable: true })
  processingAt?: Date | null;

  @Column({ nullable: true, length: 64 })
  processingToken?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => AiChatMessage, (message) => message.chat, {
    cascade: false,
  })
  messages?: AiChatMessage[];
}

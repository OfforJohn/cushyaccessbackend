import {
  Entity,
  Column,
  CreateDateColumn,
  PrimaryColumn,
  BeforeInsert,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AiChat } from './ai-chat.entity';

@Entity('ai_conversations')
export class Conversation {
  @PrimaryColumn()
  id: string;

  @Column()
  userId: string;

  @Column({ nullable: true })
  @Index()
  chatId?: string | null;

  @ManyToOne(() => AiChat, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chatId' })
  chat?: AiChat | null;

  @Column('text')
  userMessage: string;

  @Column('text')
  aiResponse: string;

  @CreateDateColumn()
  createdAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `cushy-ai_${uuidv4()}`;
  }
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

@Entity('ai_knowledge_articles')
export class AiKnowledgeArticle {
  @PrimaryColumn()
  id: string = `ai-knowledge_${uuidv4()}`;

  @Column({ length: 160 })
  title: string;

  @Column({ length: 80, nullable: true })
  category?: string | null;

  @Column('text')
  content: string;

  @Column({ default: true })
  @Index()
  isPublished: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

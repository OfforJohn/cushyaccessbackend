import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum EmailStatus {
  SENT = 'sent',
  FAILED = 'failed',
}

@Entity('email_logs')
export class EmailLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  recipient: string;

  @Column()
  subject: string;

  @Column({ nullable: true })
  template: string;

  @Column({
    type: 'enum',
    enum: EmailStatus,
    default: EmailStatus.SENT,
  })
  status: EmailStatus;

  @Column({ nullable: true })
  messageId: string;

  @Column({ type: 'int', nullable: true })
  deliveryTime: number;

  @Column({ type: 'text', nullable: true })
  error: string;

  @CreateDateColumn()
  timestamp: Date;
}

import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

@Entity()
export class ApiKeys {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string; // e.g., Third party client name

  @Column()
  userId: string;

  @Column()
  hashedKey: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `key_${uuidv4()}`;
  }
}

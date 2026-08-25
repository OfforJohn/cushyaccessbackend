import { Users } from 'src/users/model/users.entity';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  OneToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

@Entity()
@Unique(['codeValue', 'ambassadorId'])
export class PromoCodes {
  @PrimaryColumn()
  id: string;

  @Column()
  ambassadorId: string;

  @OneToOne(() => Users, (user) => user.promoCode)
  @JoinColumn({ name: 'ambassadorId' })
  ambassador: Users;

  @ManyToMany(() => Users)
  @JoinTable({
    name: 'promo_code_consumers',
    joinColumn: { name: 'promoCodeId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'consumerId', referencedColumnName: 'id' },
  })
  consumers: Users[];

  @Column()
  ambassadorsReward: number;

  @Column()
  consumersReward: number;

  @Column({ default: false })
  isDisabled: boolean;

  @Column()
  codeValue: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  beforeInsert() {
    this.id = `pc_${uuidv4()}`;
  }
}

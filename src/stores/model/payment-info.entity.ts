import { BeforeInsert, Column, Entity, OneToOne, PrimaryColumn } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Users } from '../../users/model/users.entity';

@Entity()
export class PaymentInfo {
  @PrimaryColumn()
  id: string;

  @Column()
  accountName: string;

  @Column()
  accountNumber: string;

  @Column()
  bank: string;

  @Column()
  userId: string;

  @OneToOne(() => Users)
  user: Users;

  @BeforeInsert()
  beforeInsert() {
    this.id = `pi_${uuidv4()}`;
  }
}

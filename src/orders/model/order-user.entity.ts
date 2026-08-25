import { Entity, Column, PrimaryColumn, BeforeInsert } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

@Entity()
export class OrderUser {
  @PrimaryColumn()
  id: string;

  @Column({ nullable: true })
  fullName: string;

  @Column({ nullable: true })
  phoneNumber: string;

  @Column({ nullable: true })
  emailAddress: string;

  @Column({ nullable: true })
  deliveryAddress: string;

  @Column({ nullable: true })
  locationId: string;

  @BeforeInsert()
  beforeInsert() {
    this.id = `ordus_${uuidv4()}`;
  }
}

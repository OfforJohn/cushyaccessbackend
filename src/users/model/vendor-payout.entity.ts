import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from "typeorm";
import { Users } from "./users.entity";

@Entity()
export class VendorPayoutDetails {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  bankName: string;

  @Column()
  accountNumber: string;

  @Column()
  accountName: string;

  @Column()
  bankCode: string;

  @Column({ nullable: true })
  recipientCode?: string;

  @OneToOne(() => Users, (user) => user.payoutDetails)
  @JoinColumn()
  user: Users;
}

import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class AppSetting {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  key: string;

  @Column({nullable: true})
  value: boolean;

  @Column({ nullable: true })
  createdBy: string;
}

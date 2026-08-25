// vendor-category.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class VendorCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  key: string;

  @Column()
  title: string;

  @Column()
  url: string;

  @Column()
  color: string;

  @Column({ default: true })
  isAvailable: boolean;
}

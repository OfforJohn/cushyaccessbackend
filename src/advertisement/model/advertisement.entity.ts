import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import { AdvertisementCategory } from './advertisement-category.enum';
import { CallToAction } from './call-to-action';
import { v4 as uuidv4 } from 'uuid';
@Entity()
export class Advertisements {
  @PrimaryColumn()
  id: string;

  @Column({ type: 'enum', enum: AdvertisementCategory })
  category: AdvertisementCategory;

  @Column({ type: 'json' })
  callToAction: CallToAction[];

  @Column()
  url: string;

  @BeforeInsert()
  beforeInsert() {
    this.id = `ads_${uuidv4()}`;
  }
}

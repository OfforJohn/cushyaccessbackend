import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Rider } from './rider.entity';

@Entity('rider_location_history')
@Index('IDX_rider_location_rider_timestamp', ['riderId', 'timestamp'])
@Index('IDX_rider_location_trip', ['tripId'])
@Index('IDX_rider_location_timestamp', ['timestamp'])
export class RiderLocationHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index('IDX_rider_location_rider_id')
  riderId: string;

  @ManyToOne(() => Rider, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'riderId' })
  rider: Rider;

  @Column('decimal', { precision: 10, scale: 8 })
  latitude: number;

  @Column('decimal', { precision: 11, scale: 8 })
  longitude: number;

  @Column('float', { nullable: true })
  accuracy: number;

  @Column('float', { nullable: true })
  altitude: number;

  @Column('float', { nullable: true })
  speed: number;

  @Column('float', { nullable: true })
  heading: number;

  @Column({ nullable: true })
  tripId: string;

  @Column({ default: false })
  isActive: boolean;

  @Column('jsonb', { nullable: true })
  metadata: {
    batteryLevel?: number;
    networkType?: string;
    provider?: string;
  };

  @CreateDateColumn()
  timestamp: Date;

  @Column('geometry', {
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  @Index('IDX_rider_location_geometry', { spatial: true })
  location: any;
}
import {
  BeforeInsert,
  Column,
  Entity,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { AppLevelCharges } from './app-level-charges.entity';
import { ChargeType } from '../enum/charge-type.enum';
import { OrderTypes } from '../enum/order-types.enum';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
@Entity()
export class Charges {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: ChargeType, default: ChargeType.fixed })
  chargeType: ChargeType;

  @Column()
  value: number;

  @ManyToOne(
    () => AppLevelCharges,
    (appLevelCharges) => appLevelCharges.charges,
  )
  appLevelCharges: AppLevelCharges;

  @Column()
  chargeCategory: OrderTypes;

  @Column()
  appLevelChargesId: string;

  @BeforeInsert()
  beforeInsert() {
    this.id = `ch_${uuidv4()}`;
  }

  static initAppLevelCharges() {
    const configService = new ConfigService();
    const deliveryFeePerKmForBike = configService.get<number>(
      'BIKE_DELIVERY_FEE_PER_KM',
    );
    const deliveryFeePerKmForVan = configService.get<number>(
      'VAN_DELIVERY_FEE_PER_KM',
    );
    const logisticsServiceCharge = configService.get<number>(
      'LOGISTICS_SERVICE_CHARGE',
    );
    const qCommerseServiceCharge = configService.get<number>(
      'Q_COMMERCE_SERVICE_CHARGE',
    );
    const charges = [
      {
        name: 'logisticServiceCharge',
        chargeType: ChargeType.fixed,
        value: logisticsServiceCharge,
        chargeCatgeory: OrderTypes.logistics,
      },
      {
        name: 'qCommerceServiceCharge',
        chargeType: ChargeType.fixed,
        value: qCommerseServiceCharge,
        chargeCatgeory: OrderTypes.q_commerce,
      },
    ];

    return {
      deliveryFeePerKmForBike,
      deliveryFeePerKmForVan,
      charges,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { OrdersService } from '../services/orders.service';
import { StandardResponse } from '../../common/module/standard-response';
import { OrderTypes } from '../model/enum/order-types.enum';
import { ChargeNode } from '../model/charges/charge-node.entity';
import { VehicleType } from '../model/enum/vechicle-type.enum';
import { StoreService } from 'src/stores/services/stores.service';

@Injectable()
export class AICalculateDeliveryUseCase {
  constructor(
    private readonly orderService: OrdersService,
  ) {}

  async execute(
    pickUpAddress: string,
    dropOffAddress: string,
  ) {
    // Calculate distance
    const distanceInKm = await this.orderService.calculateLogisticDeliveryDistance(
      pickUpAddress,
      dropOffAddress,
    );

    // Get app level charges
    const appLevelCharges = await this.orderService.getAppLevelCharges();

    const vechicleDeliveryFee = appLevelCharges.deliveryFeePerKmForBike

    // Calculate delivery fee based on distance
    let deliveryFee =
      distanceInKm.distanceInKm * (vechicleDeliveryFee + 1);

    let totalCharges = deliveryFee;

    const chargeNodes: ChargeNode[] = [];

    // delivery fee node
    const deliveryFeeChargeNode = new ChargeNode();
    deliveryFeeChargeNode.amount = deliveryFee;
    deliveryFeeChargeNode.name = 'deliveryFee';
    chargeNodes.push(deliveryFeeChargeNode);

    // Add other charges
    appLevelCharges.charges?.forEach((charge) => {
      if (charge.chargeCategory == OrderTypes.q_commerce) {
        totalCharges += charge.value;

        const chargeNode = new ChargeNode();
        chargeNode.amount = charge.value;
        chargeNode.name = charge.name;
        chargeNodes.push(chargeNode);
      }
    });

    return new StandardResponse(false, 'CHARGES_CALCULATED_SUCCESSFULLY', {
      totalCharges,
      chargeNodes,
    });
  }
}

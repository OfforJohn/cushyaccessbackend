import { Injectable } from '@nestjs/common';
import { OrdersService } from '../services/orders.service';
import { StandardResponse } from '../../common/module/standard-response';
import { OrderTypes } from '../model/enum/order-types.enum';
import { ChargeNode } from '../model/charges/charge-node.entity';
import { VehicleType } from '../model/enum/vechicle-type.enum';
import { StoreService } from 'src/stores/services/stores.service';

@Injectable()
export class CalculateDeliveryUseCase {
  constructor(
    private readonly orderService: OrdersService,
    private readonly storeService: StoreService,
  ) {}

  async execute(
    pickUpLoactionId: string,
    dropOffLocationId: string,
    vechicleType: VehicleType,
    orderType: OrderTypes,
  ) {
    // Calculate distance
    const distanceInKm = await this.orderService.calculateDeliveryDistance(
      pickUpLoactionId,
      dropOffLocationId,
    );

    // Get app level charges
    const appLevelCharges = await this.orderService.getAppLevelCharges();

    // 🔥 NEW: Check if global free delivery is ON
    const isFreeDelivery = await this.storeService.isFreeDeliveryActive();

    const vechicleDeliveryFee =
      vechicleType == VehicleType.bike
        ? appLevelCharges.deliveryFeePerKmForBike
        : appLevelCharges.deliveryFeePerKmForVan;

    // Calculate delivery fee based on distance
    let deliveryFee =
      distanceInKm.distanceInKm * (vechicleDeliveryFee + 1);

    // 🔥 Apply global free delivery
    if (isFreeDelivery) {
      deliveryFee = 0;
    }

    let totalCharges = deliveryFee;

    const chargeNodes: ChargeNode[] = [];

    // delivery fee node
    const deliveryFeeChargeNode = new ChargeNode();
    deliveryFeeChargeNode.amount = deliveryFee;
    deliveryFeeChargeNode.name = 'deliveryFee';
    chargeNodes.push(deliveryFeeChargeNode);

    // Add other charges
    appLevelCharges.charges?.forEach((charge) => {
      if (charge.chargeCategory == orderType) {
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
      isFreeDelivery, // optional → frontend can show "Free Delivery Active"
    });
  }
}

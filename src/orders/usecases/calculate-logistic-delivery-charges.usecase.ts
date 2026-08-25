import { Injectable } from '@nestjs/common';
import { OrdersService } from '../services/orders.service';
import { StandardResponse } from '../../common/module/standard-response';
import { VehicleType } from '../model/enum/vechicle-type.enum';

@Injectable()
export class CalculateLogisticDeliveryUseCase {
  constructor(private readonly orderService: OrdersService) {}

  async execute(
    pickUpLocation: string,
    dropOffLocation: string,
    vehicleType: VehicleType,
  ) {
    // Calculate distance
    const { distanceInKm, duration, totalCharges, chargeNodes } =
      await this.orderService.computeLogisticsCalculation(
        pickUpLocation,
        dropOffLocation,
        vehicleType,
      );
    return new StandardResponse(false, 'CHARGED_CALCULATED_SUCCESSFULLY', {
      totalCharges,
      chargeNodes,
      distanceInKm,
      duration,
    });
  }
}

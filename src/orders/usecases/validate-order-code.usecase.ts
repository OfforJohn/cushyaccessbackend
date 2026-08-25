import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Orders } from '../model/order.entity';
import { OrderStatus } from '../model/enum/order-status.enum';
import { UpdateOrderTrackingUseCase } from './update-order-tracking.usecase';
import { StandardResponse } from '../../common/module/standard-response';

@Injectable()
export class ValidateOrderCodeUseCase {
  constructor(
    @InjectRepository(Orders)
    private readonly ordersRepository: Repository<Orders>,
    private readonly updateOrderTrackingUseCase: UpdateOrderTrackingUseCase,
  ) {}

  async validateDeliveryCode(
    orderId: string,
    code: string,
    riderUserId: string,
  ): Promise<StandardResponse> {
    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
      relations: ['rider'],
    });
    if (!order) {
      throw new NotFoundException(
        new StandardResponse(true, 'ORDER_NOT_FOUND'),
      );
    }

    if (!order.deliveryCode) {
      throw new BadRequestException(
        new StandardResponse(true, 'ORDER_HAS_NO_DELIVERY_CODE'),
      );
    }

    if (!order.rider || order.rider.userId !== riderUserId) {
      throw new ForbiddenException(
        new StandardResponse(true, 'ORDER_NOT_ASSIGNED_TO_RIDER'),
      );
    }

    if (order.deliveryCode !== code) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_DELIVERY_CODE'),
      );
    }

    if (order.status === OrderStatus.delivered) {
      return new StandardResponse(false, 'DELIVERY_CODE_ALREADY_VALIDATED');
    }

    if (order.status !== OrderStatus.in_transit) {
      throw new BadRequestException(
        new StandardResponse(true, 'ORDER_NOT_IN_TRANSIT'),
      );
    }

    // Code matches -> Transition status to delivered using tracking usecase
    await this.updateOrderTrackingUseCase.handle(orderId, {
      status: OrderStatus.delivered,
    });

    return new StandardResponse(false, 'DELIVERY_CODE_VALIDATED_SUCCESSFULLY');
  }
}

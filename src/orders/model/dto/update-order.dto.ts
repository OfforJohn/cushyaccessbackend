import { IsEnum, IsOptional } from 'class-validator';
import { OrderStatus } from '../enum/order-status.enum';

export class UpdateOrderTrackingDto {
  @IsEnum(OrderStatus, { message: 'PENDING, PICKED_UP, DELIVERED, CANCELLED' })
  status: OrderStatus;

  @IsOptional()
  cancellationReason?: string;
}

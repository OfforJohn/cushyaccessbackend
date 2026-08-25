import { Injectable } from '@nestjs/common';
import { CommonService } from '../../common/common.service';
import { UpdateOrderTrackingUseCase } from './update-order-tracking.usecase';

@Injectable()
export class UserCancelOrderUseCase {
  constructor(
    private readonly commonService: CommonService,
    private readonly updateOrderTrackingUseCase: UpdateOrderTrackingUseCase,
  ) {}

  async execute(orderId: string) {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    return this.updateOrderTrackingUseCase.cancelPendingOrderForCustomer(
      orderId,
      authenticatedUser.id,
    );
  }
}

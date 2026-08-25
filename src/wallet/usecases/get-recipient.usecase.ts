import { Injectable } from '@nestjs/common';
import { UsersService } from '../../users/services/users.service';
import { StandardResponse } from '../../common/module/standard-response';
import { WalletService } from '../services/wallet.service';
import { CommonService } from '../../common/common.service';
import { WalletMapper } from '../services/wallet.mapper';

@Injectable()
export class GetRecipientUseCase {
  constructor(
    private readonly userService: UsersService,
    private readonly walletService: WalletService,
    private readonly commonService: CommonService,
  ) {}

  async execute(emailOrMobile: string) {
    const user = await this.userService.findByEmailOrMobile(emailOrMobile);
    if (!user) {
      return new StandardResponse(true, 'USER_NOT_FOUND');
    }

    //TODO: check if user isSuspended

    const receipientUserWallet = await this.walletService.isExistingWallet(
      user.id,
    );

    if (!receipientUserWallet) {
      return new StandardResponse(true, 'RECIPIENT_WALLET_NOT_INITALIZED');
    }

    const authenticatedUser = await this.commonService.getLoggedInUser();

    if (authenticatedUser.id == user.id) {
      return new StandardResponse(true, 'CANNOT_PERFORM_SELF_TRANSACTION');
    }

    const recipientDto = new WalletMapper().mapToRecipient(user);
    return new StandardResponse(
      false,
      'USER_FETCHED_SUCCESSFULLY',
      recipientDto,
    );
  }
}

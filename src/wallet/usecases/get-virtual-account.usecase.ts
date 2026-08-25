import { Injectable, NotFoundException } from '@nestjs/common';
import { VirtualAccountsService } from '../services/virtual-account.service';
import { WalletService } from '../services/wallet.service';
import { StandardResponse } from 'src/common/module/standard-response';
import { WalletMapper } from '../services/wallet.mapper';
import { CreateVirtualAccountDto } from '../model/dto/create-virtual-account.dto';
import { CommonService } from '../../common/common.service';
import { ForbiddenException } from '@nestjs/common';

@Injectable()
export class GetVirtualAccountUseCase {
  constructor(
    private readonly virtualAccountService: VirtualAccountsService,
    private readonly walletService: WalletService,
    private readonly commonService: CommonService,
  ) {}

  async execute(walletId: string) {
    const isExistingWallet = await this.walletService.existingWallet(walletId);

    if (!isExistingWallet) {
      throw new NotFoundException(
        new StandardResponse(true, 'WALLET_NOT_FOUND'),
      );
    }
    const authenticatedUser = await this.commonService.getLoggedInUser();
    if (isExistingWallet.userId !== authenticatedUser.id) {
      throw new ForbiddenException(
        new StandardResponse(true, 'UNAUTHORIZED_WALLET_ACCESS'),
      );
    }

    let virtualAccount =
      await this.virtualAccountService.getVirtualAccount(walletId);

    if (!virtualAccount) {
      const createDto: CreateVirtualAccountDto = {
        userId: isExistingWallet.userId,
        walletId: isExistingWallet.id,
        email: isExistingWallet.user.email,
        mobile: isExistingWallet.user.mobile,
        callingCode: isExistingWallet.user.callingCode,
        firstName: isExistingWallet.user.firstName,
        lastName: isExistingWallet.user.lastName,
      };

      virtualAccount =
        await this.virtualAccountService.createVirtualAccount(createDto);

      return new StandardResponse(
        false,
        'VIRTUAL_ACCOUNT_CREATED',
        WalletMapper.mapAccount(virtualAccount),
      );
    }

    return new StandardResponse(
      false,
      'VIRTUAL_ACCOUNT_FETCHED',
      WalletMapper.mapAccount(virtualAccount),
    );
  }
}

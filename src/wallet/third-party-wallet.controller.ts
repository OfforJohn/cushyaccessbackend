import { Body, Controller, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { GetWalletUsecase } from './usecases/get-wallet.usecase';
import { SendFundsUsecase } from './usecases/send-fund.usecase';
import { GetTransactionListUseCase } from './usecases/get-transaction-list.usecase';
import { GetTransactionDetailsUseCase } from './usecases/get-transaction-details.usecase';
import { PaginationRequest } from 'src/common/module/pagination-request';
import { SendFundsDto } from './model/dto/send-fund.dto';
import { GetVirtualAccountUseCase } from './usecases/get-virtual-account.usecase';
import { WalletService } from './services/wallet.service';
import { PinDto } from './model/dto/pin.dto';
import { UpdatePinDto } from './model/dto/update-pin.dto';
import { ValidatePin } from './model/dto/validate-pin.dto';
import { GetRecipientUseCase } from './usecases/get-recipient.usecase';
import { GetRecentTransactUserUseCase } from './usecases/get-recent-transact-users.usecase';
import { Public } from '../auth/service/public.decorator';
import { ApiKeyAuth } from '../api-keys/api-key.decorator';

@Controller('/api/v1/t/wallet/')
@Public()
@ApiKeyAuth()
export class ThirdPartyWalletController {
  constructor(
    private readonly getWalletWalletUseCase: GetWalletUsecase,
    private readonly sendFundUseCase: SendFundsUsecase,
    private readonly getTransactionListUseCase: GetTransactionListUseCase,
    private readonly getTransactionDetailsUseCase: GetTransactionDetailsUseCase,
    private readonly getVirtualAccountUseCase: GetVirtualAccountUseCase,
    private readonly walletService: WalletService,
    private readonly getRecipientUseCase: GetRecipientUseCase,
    private readonly getRecentTransactUsersUseCase: GetRecentTransactUserUseCase,
  ) {}

  @Get()
  async getOrInitializeWallet() {
    return await this.getWalletWalletUseCase.execute();
  }

  @Get('transactions')
  async getTransactions(@Query() pagination: PaginationRequest) {
    return await this.getTransactionListUseCase.execute(pagination);
  }

  @Get('transactions/:transactionIdOrReference')
  async getTransactionDetails(
    @Param('transactionIdOrReference') transactionIdOrReference: string,
  ) {
    return await this.getTransactionDetailsUseCase.execute(
      transactionIdOrReference,
    );
  }

  @Post('send')
  async sendFunds(
    @Body() sendFundsDto: SendFundsDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return await this.sendFundUseCase.execute(sendFundsDto, idempotencyKey);
  }

  @Get('virtual-account/:walletId')
  async getVirtualAccount(@Param('walletId') walletId: string) {
    return await this.getVirtualAccountUseCase.execute(walletId);
  }

  @Post('transaction-pin')
  async createTransactionPin(@Body() pinDto: PinDto) {
    return await this.walletService.createTransactionPin(pinDto);
  }

  @Put('transaction-pin')
  async updateTransactionPin(@Body() pinDto: UpdatePinDto) {
    return await this.walletService.updateTransactionPin(pinDto);
  }

  @Post('transaction-pin/validate')
  async validateTransactionPin(@Body() validateDto: ValidatePin) {
    return await this.walletService.validatePin(validateDto);
  }

  @Get('recipient-user')
  async getRecipientUser(@Query('query') query: string) {
    return await this.getRecipientUseCase.execute(query);
  }

  @Get('transact-users')
  async getRecentTransactUsers(@Query('query') query: string) {
    return await this.getRecentTransactUsersUseCase.execute(query);
  }
}

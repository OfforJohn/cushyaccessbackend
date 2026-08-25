import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
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
import { PayoutService } from './services/payout.service';
import { PaystackService } from './services/paystack.service';
import { TransactionService } from './services/transaction.service';
import { PayoutStatus } from 'src/users/model/payout-status.enum';
import { ManualFundingDto } from './model/dto/manual-funding.dto';
import { Permit } from 'src/auth/service/roles.decorator';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { DoctorPayoutService } from './services/doctor-payout.service';
import { GetRiderEarningsOverviewUseCase } from './usecases/get-rider-earnings-overview.usecase';
import { PayoutFiltersDto } from './model/dto/payout-filters.dto';
import { PermitAdminRoles } from 'src/auth/service/admin-roles.decorator';
import { AdminRole } from 'src/users/model/admin-roles.enum';
import { BulkWalletAdjustmentDto } from './model/dto/bulk-wallet-adjustment.dto';
import { AdminActionLoggerInterceptor } from 'src/common/interceptors/admin-action-logger.interceptor';

@Controller('/api/v1/wallet/')
@UseInterceptors(AdminActionLoggerInterceptor)
export class WalletController {
  constructor(
    private readonly getWalletWalletUseCase: GetWalletUsecase,
    private readonly sendFundUseCase: SendFundsUsecase,
    private readonly getTransactionListUseCase: GetTransactionListUseCase,
    private readonly getTransactionDetailsUseCase: GetTransactionDetailsUseCase,
    private readonly getVirtualAccountUseCase: GetVirtualAccountUseCase,
    private readonly walletService: WalletService,
    private readonly getRecipientUseCase: GetRecipientUseCase,
    private readonly getRecentTransactUsersUseCase: GetRecentTransactUserUseCase,
    private readonly payoutService: PayoutService,
    private readonly paystack: PaystackService,
    private readonly transactionService: TransactionService,
    private readonly doctorPayoutService: DoctorPayoutService,
    private readonly getRiderEarningsOverviewUseCase: GetRiderEarningsOverviewUseCase,
  ) {}

  @Get()
  async getOrInitializeWallet() {
    return await this.getWalletWalletUseCase.execute();
  }
  // @Public()
  // @Get('get-vendor-wallet/:userId')
  // async getWallet(@Param('userId') userId: string) {
  //   return await this.walletService.getWallet(userId);
  // }
  @Get('transactions')
  async getTransactions(@Query() pagination: PaginationRequest) {
    return await this.getTransactionListUseCase.execute(pagination);
  }

  @Get('rider/earnings-overview')
  @Permit([UserRoles.RIDER])
  async getRiderEarningsOverview() {
    return await this.getRiderEarningsOverviewUseCase.execute();
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

  @Post('run-payouts')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT)
  async runPayouts() {
    // Settle all merchants on demand. Calls the ungated wallet-driven routine
    // directly (NOT runDailyPayouts, which is worker-only) so the admin trigger
    // works regardless of which process serves the request.
    return await this.payoutService.runWalletPayouts();
  }

  @Get('payouts')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT)
  async getAllPayouts(@Query() filters: PayoutFiltersDto) {
    return await this.payoutService.getAllPayouts(filters);
  }

  @Get('payouts/stats')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT)
  async getPayoutStats() {
    return this.payoutService.getPayoutStats();
  }

  @Post('run-rider-payouts')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT)
  async runRiderPayouts() {
    // An admin-triggered run is intentionally manual: settle every eligible
    // rider now, regardless of their automatic weekly/monthly preference.
    return this.payoutService.runRiderPayouts({ isManual: true });
  }

  @Get('riders/payouts')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT)
  async getAllRiderPayouts(@Query() filters: PayoutFiltersDto) {
    return this.payoutService.getRiderPayouts(filters);
  }

  @Get('riders/payouts/stats')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT)
  async getRiderPayoutStats() {
    return this.payoutService.getRiderPayoutStats();
  }

  @Post('payouts/reconcile')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT)
  async reconcilePayouts() {
    return this.payoutService.reconcilePendingPayouts();
  }
  @Post('run-doctor-payouts')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT)
  async runDoctorPayouts() {
    // Settle all doctors on demand. Calls the ungated wallet-driven routine
    // directly (NOT runDoctorPayouts, which is worker-only) so the admin trigger
    // works regardless of which process serves the request.
    return await this.doctorPayoutService.runDoctorWalletPayouts();
  }

  @Get('doctors/payouts')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT)
  async getAllDoctorPayouts(
    @Query('doctorId') doctorId?: string,
    @Query('status') status?: PayoutStatus,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('minAmount') minAmount?: number,
    @Query('maxAmount') maxAmount?: number,
    @Query('bankName') bankName?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const filters: any = {};

    if (doctorId) filters.doctorId = doctorId;
    if (status) filters.status = status;
    if (startDate) filters.startDate = new Date(startDate);
    if (endDate) filters.endDate = new Date(endDate);
    if (minAmount) filters.minAmount = Number(minAmount);
    if (maxAmount) filters.maxAmount = Number(maxAmount);
    if (bankName) filters.bankName = bankName;
    if (search) filters.search = search;
    if (page) filters.page = Number(page);
    if (limit) filters.limit = Number(limit);

    return await this.doctorPayoutService.fetchAllDoctorsPayouts(filters);
  }

  // @Public()
  // @Post('create--bulk-transfer-recipient')
  // async createBulkTransfer(
  //   @Body()
  //   body: {
  //     transfers: {
  //       name: string;
  //       account_number: string;
  //       bank_code: string;
  //       currency?: string;
  //     }[];
  //   },
  // ) {
  //   if (!body.transfers || !Array.isArray(body.transfers) || body.transfers.length === 0) {
  //     return new StandardResponse(false, 'No transfers provided', null);
  //   }

  //   try {
  //     const result = await this.paystack.createBulkTransferRecipient(body.transfers);
  //     return new StandardResponse(false, 'Bulk transfer recipients created successfully', result);
  //   } catch (error) {
  //     console.error('Bulk transfer error:', error.response?.data || error.message);
  //     return new StandardResponse(true, 'Bulk transfer failed', null);
  //   }
  // }

  @Get('get-all-banks')
  async getAllBanks() {
    return await this.paystack.getAllBanks();
  }

  @Get('name-enquiry')
  async nameEnquiry(
    @Query('account_number') account_number: string,
    @Query('bank_code') bank_code: string,
  ) {
    return await this.paystack.nameEnquiry(account_number, bank_code);
  }
  @Get('get-transactions')
  @Permit([UserRoles.ADMIN])
  async getAllTransactions() {
    return await this.transactionService.getAllTransactions();
  }
  @Get('get-wallet')
  @Permit([UserRoles.ADMIN])
  async getWallet(@Query('userId') userId: string) {
    return await this.walletService.getWallet(userId);
  }
  @Get('user-payout/:userId')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT)
  async getPayout(@Param('userId') userId: string) {
    return await this.payoutService.getUserPayout(userId);
  }
  @Get('payout-status/:reference')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT)
  async getPayoutStatus(@Param('reference') reference: string) {
    return await this.payoutService.getPayoutStatus(reference);
  }

  @Permit([UserRoles.ADMIN])
  @Post('fund-wallet')
  async fundWallet(@Body() manualFundingDto: ManualFundingDto) {
    return await this.walletService.createManualFunding(manualFundingDto);
  }

  @Permit([UserRoles.ADMIN])
  @Post('debit-wallet')
  async debitWallet(@Body() manualFundingDto: ManualFundingDto) {
    return await this.walletService.createManualDebit(manualFundingDto);
  }

  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT)
  @Post('admin/bulk-adjustment')
  async bulkWalletAdjustment(@Body() dto: BulkWalletAdjustmentDto) {
    return this.walletService.createBulkManualAdjustment(dto);
  }

  @Permit([UserRoles.ADMIN])
  @Get('manual-fundings')
  async getManualFundingHistory(
    @Query('userId') userId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const options: any = {};

    if (page) options.page = Number(page);
    if (limit) options.limit = Number(limit);
    if (startDate) options.startDate = new Date(startDate);
    if (endDate) options.endDate = new Date(endDate);

    return await this.walletService.getManualFundingHistory(userId, options);
  }
  @Permit([UserRoles.ADMIN])
  @Post('reverse-manual-funding')
  async reverseManualFunding(
    @Body('transactionReference') transactionReference: string,
    @Body('reason') reason: string,
  ) {
    return await this.walletService.reverseManualFunding(
      transactionReference,
      reason,
    );
  }
  @Permit([UserRoles.ADMIN])
  @Post('debit-user-for-consultation')
  async debitUserForConsultation(
    @Body('appointmentId') appointmentId: string,
    @Body('userId') userId: string,
  ) {
    return await this.walletService.debitUserForConsultation(
      appointmentId,
      userId,
    );
  }
}

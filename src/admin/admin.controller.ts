import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { Get } from '@nestjs/common';
import { OrderStatsUseCase } from './usecases/order-stats.usecase';
import { Public } from 'src/auth/service/public.decorator';
import { parseISO } from 'date-fns';
import { OrderGraphUseCase } from './usecases/order-graph.usecase';
import { Permit } from 'src/auth/service/roles.decorator';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { VendorStatsUseCase } from './usecases/vendor-stats.usecase';
import { VendorListUseCase } from './usecases/vendor-list.usecase';
import { VendorListDto } from './dto/vendor-list.dto';
import { AdminService } from './services/admin.service';
import { VendorVerificationDto } from './dto/vendor-verification.dto';
import { UserCountUsecase } from './usecases/total-users.usecase';
import { TotalBalanceUseCase } from './usecases/total-balance.usecase';
import { StandardResponse } from 'src/common/module/standard-response';
import { DailyTransactionPercentageUseCase } from './usecases/daily-transaction-percentage.usecase';
import { UserSummariesUseCase } from './usecases/user-summaries.usecase';

import { ActiveUsersUseCase } from './usecases/active-users.usecase';
import { GetRiderUseCase } from './usecases/get-riders-usecase';
import { AssignRideToOrderUseCase } from './usecases/assign-ride-to-order.usecase';
import { RiderEarningsUseCase } from './usecases/rider-earnings.usecase';
import {
  UpdateRiderFlagsUseCase,
  UpdateRiderFlagsDto,
} from './usecases/update-rider-flags.usecase';
import { StoreService } from 'src/stores/services/stores.service';
import { AdminRole } from 'src/users/model/admin-roles.enum';
import { AdminActionLoggerInterceptor } from 'src/common/interceptors/admin-action-logger.interceptor';
import { PermitAdminRoles } from 'src/auth/service/admin-roles.decorator';
import { CreateRiderDto } from './dto/create-rider.dto';
import { CreateRiderUseCase } from './usecases/create-rider.usecase';
import { LogisticsOverviewUseCase } from './usecases/logistics-overview.usecase';
import {
  ReviewRiderDocumentDto,
  ReviewRiderDocumentUseCase,
} from './usecases/review-rider-document.usecase';
import { GetRiderDocumentsUseCase } from './usecases/get-rider-documents.usecase';
import { DeletePlatformAccountUseCase } from './usecases/delete-platform-account.usecase';
import { DeleteAccountDto } from './dto/delete-account.dto';

@UseInterceptors(AdminActionLoggerInterceptor)
@Controller('api/v1/admin')
export class AdminController {
  AllUsersController: any;
  constructor(
    private readonly adminService: AdminService,
    private readonly storeService: StoreService,
    private readonly totalOrderUseCase: OrderStatsUseCase,
    private readonly orderGraphUseCase: OrderGraphUseCase,
    private readonly vendorStatsUseCase: VendorStatsUseCase,
    private readonly getRidersUseCase: GetRiderUseCase,
    private readonly assignRideToOrderUseCase: AssignRideToOrderUseCase,

    private readonly dailyTransactionPercentageUseCase: DailyTransactionPercentageUseCase,

    private readonly vendorListUseCase: VendorListUseCase,

    private readonly totalBalanceUseCase: TotalBalanceUseCase,

    private readonly userSummariesUseCase: UserSummariesUseCase,

    private readonly activeUsersUseCase: ActiveUsersUseCase,
    private readonly usersCountUseCase: UserCountUsecase,
    private readonly riderEarningsUseCase: RiderEarningsUseCase,
    private readonly updateRiderFlagsUseCase: UpdateRiderFlagsUseCase,
    private readonly createRiderUseCase: CreateRiderUseCase,
    private readonly logisticsOverviewUseCase: LogisticsOverviewUseCase,
    private readonly reviewRiderDocumentUseCase: ReviewRiderDocumentUseCase,
    private readonly getRiderDocumentsUseCase: GetRiderDocumentsUseCase,
    private readonly deletePlatformAccountUseCase: DeletePlatformAccountUseCase,
  ) {}

  @Get('orders-stats')
  @Permit([UserRoles.ADMIN])
  async getTotalOrders(@Query('from') from: string, @Query('to') to: string) {
    const fromDate = parseISO(from);
    const toDate = parseISO(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return new StandardResponse(true, 'INVALID_DATE_FORMAT', null);
    }

    return this.totalOrderUseCase.execute(fromDate, toDate);
  }

  @Get('user-summaries')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT)
  async getUserSummaries(
    @Query('page') page: number = 1,
    @Query('size') size: number = 10,
    @Query('search') search?: string,
    @Query('roles') roles?: string,
  ) {
    const selectedRoles = roles
      ? roles
          .split(',')
          .map((role) => role.trim())
          .filter((role): role is UserRoles =>
            Object.values(UserRoles).includes(role as UserRoles),
          )
      : undefined;
    const result = await this.userSummariesUseCase.execute(
      Number(page),
      Number(size),
      search,
      selectedRoles,
    );
    return new StandardResponse(
      false,
      'USER_SUMMARIES_FETCHED_SUCCESSFULLY',
      result,
    );
  }

  @Public()
  @Get('daily-transaction-percentage')
  async getDailyTransactionPercentage() {
    const result = await this.dailyTransactionPercentageUseCase.execute();
    return new StandardResponse(
      false,
      'DAILY_TRANSACTION_PERCENTAGE_FETCHED',
      result,
    );
  }

  @Get('order-graph')
  @Permit([UserRoles.ADMIN])
  async getOrderGraph(@Query('year') year: number) {
    if (isNaN(year)) {
      return new StandardResponse(true, 'INVALID_YEAR', null);
    }

    return this.orderGraphUseCase.execute(year);
  }
  @Public()
  @Get('vendor-stats')
  // @Permit([UserRoles.ADMIN])
  async getVendorStats(
    @Query('month') month?: number,
    @Query('year') year?: number,
  ) {
    return await this.vendorStatsUseCase.execute({ month, year });
  }
  @Public()
  @Get('vendor-list')
  // @Permit([UserRoles.ADMIN])
  async getVendorList(@Query() filter: VendorListDto) {
    return await this.vendorListUseCase.execute(filter);
  }
  @Permit([UserRoles.ADMIN])
  @Post('vendor-verification')
  async updateVendorVerificationStatus(
    @Query('vendorId') vendorId: string,
    @Body() verificationFlag: VendorVerificationDto,
  ) {
    if (!vendorId || !verificationFlag) {
      return new StandardResponse(
        true,
        'VENDOR_ID_OR_VERIFICATION_FLAG_MISSING',
        {},
      );
    }

    return await this.adminService.updateVendorVerificationStatus(
      vendorId,
      verificationFlag,
    );
  }
  @Get('dashboard-stats')
  @Permit([UserRoles.ADMIN])
  async getDashboardStats(@Query('days') days?: string) {
    // Fetch all three in parallel for performance
    const [
      usersCount,
      usersCountBreakdown,
      walletSnapshot,
      activeUsersCount,
      activeUsersBreakdown,
    ] = await Promise.all([
      this.usersCountUseCase.execute(),
      this.usersCountUseCase.executeByUserCategory(),
      this.totalBalanceUseCase.executeSnapshot(),
      this.activeUsersUseCase.execute(days),
      this.activeUsersUseCase.executeByUserCategory(days),
    ]);

    const activeUsersPeriod =
      typeof days === 'string' && days.endsWith('d') ? days : `${days || 100}d`;

    return new StandardResponse(false, 'DASHBOARD_STATS_FETCHED_SUCCESSFULLY', {
      usersCount,
      usersCountBreakdown,
      totalBalanceResult: walletSnapshot.total,
      totalBalanceBreakdown: walletSnapshot.breakdown,
      walletCoverage: {
        users: this.walletCoverage(
          walletSnapshot.accountCounts.users,
          walletSnapshot.walletCounts.users,
        ),
        merchants: this.walletCoverage(
          walletSnapshot.accountCounts.merchants,
          walletSnapshot.walletCounts.merchants,
        ),
        healthProfessionals: this.walletCoverage(
          walletSnapshot.accountCounts.healthProfessionals,
          walletSnapshot.walletCounts.healthProfessionals,
        ),
      },
      activeUsersResult: {
        activeUsers: activeUsersCount,
        period: activeUsersPeriod,
      },
      activeUsersBreakdown,
    });
  }

  private walletCoverage(accounts: number, initializedWallets: number) {
    return {
      accounts,
      initializedWallets,
      missingWallets: Math.max(accounts - initializedWallets, 0),
    };
  }
  @Public()
  @Patch('update-user-role')
  async updateUserRole(
    @Query('userId') userId: string,
    @Query('newRole') newRole: UserRoles,
  ) {
    if (!userId || !newRole) {
      return new StandardResponse(true, 'USER_ID_OR_NEW_ROLE_MISSING', {});
    }
    return this.adminService.updateUserRole(userId, newRole);
  }
  @Get('get-all-riders')
  @Permit([UserRoles.ADMIN])
  async getAllRiders() {
    return this.getRidersUseCase.execute();
  }

  @Post('riders')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.OPS_MANAGER)
  async createRider(@Body() dto: CreateRiderDto) {
    return this.createRiderUseCase.execute(dto);
  }

  @Get('riders/:riderId/documents')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.OPS_MANAGER)
  async getRiderDocuments(@Param('riderId') riderId: string) {
    return this.getRiderDocumentsUseCase.execute(riderId);
  }

  @Delete('accounts/:userId')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN)
  async deletePlatformAccount(
    @Param('userId') userId: string,
    @Body() dto: DeleteAccountDto,
  ) {
    return this.deletePlatformAccountUseCase.execute(
      userId,
      dto.confirmationEmail,
    );
  }

  @Patch('riders/:riderId/documents/:documentId')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.OPS_MANAGER)
  async reviewRiderDocument(
    @Param('riderId') riderId: string,
    @Param('documentId') documentId: string,
    @Body() dto: ReviewRiderDocumentDto,
  ) {
    return this.reviewRiderDocumentUseCase.execute(riderId, documentId, dto);
  }

  @Get('logistics-overview')
  @Permit([UserRoles.ADMIN])
  async getLogisticsOverview(
    @Query('page') page?: number,
    @Query('size') size?: number,
    @Query('location') location?: string,
  ) {
    return this.logisticsOverviewUseCase.execute(page, size, location);
  }
  @Post('assign-rider-to-order')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.OPS_MANAGER)
  async assignRideToOrder(
    @Query('orderId') orderId: string,
    @Query('riderId') riderId: string,
  ) {
    return this.assignRideToOrderUseCase.execute(orderId, riderId);
  }

  @Patch('toggle-global-free-delivery')
  @Permit([UserRoles.ADMIN])
  async toggleGlobalFreeDelivery(
    @Body('isActive') isActive: boolean,
  ): Promise<StandardResponse> {
    await this.storeService.setGlobalFreeDelivery(isActive);
    return new StandardResponse(
      false,
      `Free delivery ${isActive ? 'enabled' : 'disabled'} for all stores`,
    );
  }
  @Get('get-global-free-delivery-status')
  @Permit([UserRoles.ADMIN])
  async getGlobalFreeDelivery(): Promise<StandardResponse> {
    const result = await this.storeService.isFreeDeliveryActive();
    return new StandardResponse(
      false,
      'Free delivery status fetched successfully',
      { result },
    );
  }

  @Get('rider-earnings/:riderId')
  @Permit([UserRoles.ADMIN])
  async getRiderEarnings(
    @Param('riderId') riderId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.riderEarningsUseCase.getRiderEarnings(
      riderId,
      startDate,
      endDate,
    );
  }

  @Get('rider-earnings-summary')
  @Permit([UserRoles.ADMIN])
  async getRiderEarningsSummary(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.riderEarningsUseCase.getRiderEarningsSummary(
      startDate,
      endDate,
    );
  }

  @Patch('update-admin-role')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN)
  async updateAdminRole(
    @Query('userId') userId: string,
    @Query('adminRole') adminRole: AdminRole,
  ) {
    if (!userId || !adminRole) {
      return new StandardResponse(true, 'USER_ID_OR_ADMIN_ROLE_MISSING', {});
    }
    return this.adminService.updateAdminRole(userId, adminRole);
  }

  @Post('create-admin')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN)
  async createAdmin(
    @Body()
    body: {
      firstName: string;
      lastName: string;
      email: string;
      password: string;
      mobile: string;
      adminRole: AdminRole;
    },
  ) {
    const { firstName, lastName, email, password, mobile, adminRole } = body;
    if (!firstName || !lastName || !email || !password || !adminRole) {
      return new StandardResponse(true, 'MISSING_REQUIRED_FIELDS', {});
    }
    return this.adminService.createAdmin(
      firstName,
      lastName,
      email,
      password,
      mobile || '',
      adminRole,
    );
  }

  @Get('all-admins')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN)
  async getAllAdmins() {
    return this.adminService.getAllAdmins();
  }

  @Patch('reset-admin-password')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN)
  async resetAdminPassword(
    @Body() body: { userId: string; newPassword: string },
  ) {
    const { userId, newPassword } = body;
    if (!userId || !newPassword) {
      return new StandardResponse(true, 'USER_ID_AND_PASSWORD_REQUIRED', {});
    }
    if (newPassword.length < 6) {
      return new StandardResponse(true, 'PASSWORD_TOO_SHORT', {});
    }
    return this.adminService.resetAdminPassword(userId, newPassword);
  }

  @Delete('delete-admin')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN)
  async deleteAdmin(@Query('userId') userId: string, @Req() req: any) {
    if (!userId) {
      return new StandardResponse(true, 'USER_ID_REQUIRED', {});
    }
    const requestingUserId = req.user?.userId || req.user?.id;
    return this.adminService.deleteAdmin(userId, requestingUserId);
  }
  @Permit([UserRoles.ADMIN])
  @Get('merchants')
  async adminMerchants() {
    return this.adminService.adminMerchants();
  }

  @Patch('rider-flags/:riderId')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.OPS_MANAGER)
  async updateRiderFlags(
    @Param('riderId') riderId: string,
    @Body() flags: UpdateRiderFlagsDto,
  ) {
    return this.updateRiderFlagsUseCase.execute(riderId, flags);
  }
}

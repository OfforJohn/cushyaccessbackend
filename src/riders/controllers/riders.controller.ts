import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFiles,
  Get,
  Param,
  Patch,
  Put,
  BadRequestException,
  Header,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { RegisterBikeRiderUseCase } from '../usecases/register-bike-rider.usecase';
import { RegisterBikeRiderDto } from '../dto/register-rider-bike.dto';
import { Public } from '../../auth/service/public.decorator';
import { Permit } from '../../auth/service/roles.decorator';
import { UserRoles } from '../../users/model/user-roles.enum';
import { GetRiderProfileUseCase } from '../usecases/get-rider-profile.usecase';
import {
  StatusUpdateDto,
  UpdateRiderStatusUseCase,
} from '../usecases/update-rider-status.usecase';
import {
  LocationUpdateDto,
  UpdateRiderLocationUseCase,
} from '../usecases/update-rider-location.usecase';
import { ToggleOnlineStatusUseCase } from '../usecases/toggle-online-status.usecase';
import { GetRiderStatsUseCase } from '../usecases/get-rider-stats.usecase';
import { GetRiderDashboardUseCase } from '../usecases/get-rider-dashboard.usecase';
import { GetHotspotsUseCase } from '../usecases/get-hotspots.usecase';
import {
  UpdateRiderBikeUseCase,
  UpdateBikeDto,
} from '../usecases/update-rider-bike.usecase';
import { GetRiderOrderHistoryUseCase } from '../usecases/get-rider-order-history.usecase';
import { UploadRiderDocumentsUseCase } from '../usecases/upload-rider-documents.usecase';
import {
  UpdateRiderPayoutScheduleUseCase,
  UpdatePayoutScheduleDto,
} from '../usecases/update-payout-schedule.usecase';
import {
  UpdateRiderPayoutDetailsUseCase,
  UpdateRiderPayoutDetailsDto,
} from '../usecases/update-payout-details.usecase';
import { GetRiderPayoutDetailsUseCase } from '../usecases/get-payout-details.usecase';
import { RequestRiderPayoutUseCase } from '../usecases/request-payout.usecase';
import { SkipThrottle } from '@nestjs/throttler';
import { UploadRiderDocumentsDto } from '../dto/upload-rider-documents.dto';
import { UpdateRiderDocumentsUseCase } from '../usecases/update-rider-documents.usecase';
import { PermitAdminRoles } from '../../auth/service/admin-roles.decorator';
import { AdminRole } from '../../users/model/admin-roles.enum';
import { RiderGateway } from '../gateways/rider.gateway';
import { CommonService } from '../../common/common.service';
import { StandardResponse } from '../../common/module/standard-response';
import { getRiderOrderOfferConfig } from '../rider-order-offer.config';

@Controller('api/v1/riders')
export class RidersController {
  constructor(
    private readonly registerBikeRiderUseCase: RegisterBikeRiderUseCase,
    private readonly getRiderProfileUseCase: GetRiderProfileUseCase,
    private readonly updateRiderStatusUseCase: UpdateRiderStatusUseCase,
    private readonly updateRiderLocationUseCase: UpdateRiderLocationUseCase,
    private readonly toggleOnlineStatusUseCase: ToggleOnlineStatusUseCase,
    private readonly getRiderStatsUseCase: GetRiderStatsUseCase,
    private readonly getRiderDashboardUseCase: GetRiderDashboardUseCase,
    private readonly getHotspotsUseCase: GetHotspotsUseCase,
    private readonly updateRiderBikeUseCase: UpdateRiderBikeUseCase,
    private readonly getRiderOrderHistoryUseCase: GetRiderOrderHistoryUseCase,
    private readonly uploadRiderDocumentsUseCase: UploadRiderDocumentsUseCase,
    private readonly updateRiderPayoutScheduleUseCase: UpdateRiderPayoutScheduleUseCase,
    private readonly updateRiderPayoutDetailsUseCase: UpdateRiderPayoutDetailsUseCase,
    private readonly getRiderPayoutDetailsUseCase: GetRiderPayoutDetailsUseCase,
    private readonly requestRiderPayoutUseCase: RequestRiderPayoutUseCase,
    private readonly updateRiderDocumentsUseCase: UpdateRiderDocumentsUseCase,
    private readonly riderGateway: RiderGateway,
    private readonly commonService: CommonService,
  ) {}

  @Public()
  @Post('register/bike')
  async registerBikeRider(@Body() registerRiderDto: RegisterBikeRiderDto) {
    return this.registerBikeRiderUseCase.execute(registerRiderDto);
  }

  @Get('profile')
  @Permit([UserRoles.RIDER, UserRoles.ADMIN])
  async getProfile() {
    return this.getRiderProfileUseCase.execute();
  }

  @Get('stats/:riderId')
  @Permit([UserRoles.RIDER])
  async getStats(@Param('riderId') riderId: string) {
    return this.getRiderStatsUseCase.execute(riderId);
  }

  @Get('dashboard')
  @Permit([UserRoles.RIDER])
  async getDashboard() {
    return this.getRiderDashboardUseCase.execute();
  }

  @Get('hotspots')
  @Permit([UserRoles.RIDER])
  async getHotspots() {
    return this.getHotspotsUseCase.execute();
  }

  @SkipThrottle()
  @Get('available-orders')
  @Permit([UserRoles.RIDER])
  @Header(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate',
  )
  async getAvailableOrders() {
    const user = await this.commonService.getLoggedInUser();
    const orders = await this.riderGateway.getAvailableOrdersForUser(user.id);
    return new StandardResponse(false, 'AVAILABLE_ORDERS_FETCHED', {
      orders,
      count: orders.length,
      radiusKm: getRiderOrderOfferConfig().radiusKm,
    });
  }

  @Patch(':riderId/status')
  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.OPS_MANAGER)
  async updateStatus(
    @Param('riderId') riderId: string,
    @Body() statusUpdate: StatusUpdateDto,
  ) {
    return this.updateRiderStatusUseCase.execute(riderId, statusUpdate);
  }

  @Post(':riderId/online')
  @Permit([UserRoles.RIDER])
  async goOnline(@Param('riderId') riderId: string) {
    return this.toggleOnlineStatusUseCase.execute(riderId, true);
  }

  @Post(':riderId/offline')
  @Permit([UserRoles.RIDER])
  async goOffline(@Param('riderId') riderId: string) {
    return this.toggleOnlineStatusUseCase.execute(riderId, false);
  }

  @SkipThrottle()
  @Patch(':riderId/location')
  @Permit([UserRoles.RIDER])
  async updateLocation(
    @Param('riderId') riderId: string,
    @Body() locationData: LocationUpdateDto,
  ) {
    return this.updateRiderLocationUseCase.execute(riderId, locationData);
  }

  @Put('bike')
  @Permit([UserRoles.RIDER])
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'bikeRegistration', maxCount: 1 },
        { name: 'riderPermit', maxCount: 1 },
      ],
      {
        limits: { fileSize: 8 * 1024 * 1024, files: 2 },
        fileFilter: (_request, file, callback) => {
          if (
            !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
          ) {
            callback(
              new BadRequestException(
                'Documents must be JPEG, PNG, or WebP images',
              ),
              false,
            );
            return;
          }
          callback(null, true);
        },
      },
    ),
  )
  async updateBike(
    @UploadedFiles()
    files: {
      bikeRegistration?: Express.Multer.File[];
      riderPermit?: Express.Multer.File[];
    },
    @Body() dto: UpdateBikeDto,
  ) {
    return this.updateRiderBikeUseCase.execute(dto, {
      bikeRegistration: files?.bikeRegistration?.[0],
      riderPermit: files?.riderPermit?.[0],
    });
  }

  @Get('orders/history')
  @Permit([UserRoles.RIDER])
  async getOrderHistory() {
    return this.getRiderOrderHistoryUseCase.execute();
  }

  @Post('upload-documents')
  @Permit([UserRoles.RIDER])
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'ninSlip', maxCount: 1 },
        { name: 'permitFront', maxCount: 1 },
        { name: 'permitBack', maxCount: 1 },
        { name: 'bikeRegistration', maxCount: 1 },
      ],
      {
        limits: { fileSize: 8 * 1024 * 1024, files: 4 },
        fileFilter: (_request, file, callback) => {
          if (
            !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
          ) {
            callback(
              new BadRequestException(
                'Documents must be JPEG, PNG, or WebP images',
              ),
              false,
            );
            return;
          }
          callback(null, true);
        },
      },
    ),
  )
  async uploadDocs(
    @UploadedFiles()
    files: {
      ninSlip?: Express.Multer.File[];
      permitFront?: Express.Multer.File[];
      permitBack?: Express.Multer.File[];
      bikeRegistration?: Express.Multer.File[];
    },
    @Body()
    body: UploadRiderDocumentsDto,
  ) {
    return this.uploadRiderDocumentsUseCase.execute({
      ninSlip: files?.ninSlip?.[0],
      permitFront: files?.permitFront?.[0],
      permitBack: files?.permitBack?.[0],
      bikeRegistration: files?.bikeRegistration?.[0],
      ...body,
    });
  }

  @Put('payout-schedule')
  @Permit([UserRoles.RIDER])
  async updatePayoutSchedule(@Body() dto: UpdatePayoutScheduleDto) {
    return this.updateRiderPayoutScheduleUseCase.execute(dto);
  }

  @Put('payout-details')
  @Permit([UserRoles.RIDER])
  async updatePayoutDetails(@Body() dto: UpdateRiderPayoutDetailsDto) {
    return this.updateRiderPayoutDetailsUseCase.execute(dto);
  }

  @Get('payout-details')
  @Permit([UserRoles.RIDER])
  async getPayoutDetails() {
    return this.getRiderPayoutDetailsUseCase.execute();
  }

  @Post('payout/request')
  @Permit([UserRoles.RIDER])
  async requestPayout() {
    return this.requestRiderPayoutUseCase.execute();
  }

  @Patch('update-documents')
  @Permit([UserRoles.RIDER])
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'ninSlip', maxCount: 1 },
        { name: 'permitFront', maxCount: 1 },
        { name: 'permitBack', maxCount: 1 },
        { name: 'bikeRegistration', maxCount: 1 },
      ],
      {
        limits: { fileSize: 8 * 1024 * 1024, files: 4 },
        fileFilter: (_request, file, callback) => {
          if (
            !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
          ) {
            callback(
              new BadRequestException(
                'Documents must be JPEG, PNG, or WebP images',
              ),
              false,
            );
            return;
          }
          callback(null, true);
        },
      },
    ),
  )
  async updateDocuments(
    @UploadedFiles()
    files: {
      ninSlip?: Express.Multer.File[];
      permitFront?: Express.Multer.File[];
      permitBack?: Express.Multer.File[];
      bikeRegistration?: Express.Multer.File[];
    },
    @Body('correctionOnly') correctionOnly?: string,
  ) {
    return this.updateRiderDocumentsUseCase.execute({
      ninSlip: files?.ninSlip?.[0],
      permitFront: files?.permitFront?.[0],
      permitBack: files?.permitBack?.[0],
      bikeRegistration: files?.bikeRegistration?.[0],
      correctionOnly: correctionOnly === 'true',
    });
  }
}

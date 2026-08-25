import {
  Controller,
  Post,
  Body,
  Put,
  Param,
  Get,
  Header,
  Query,
  UseInterceptors,
  UploadedFiles,
  Patch,
  Delete,
  Req,
  Headers,
} from '@nestjs/common';
import { StandardResponse } from '../../common/module/standard-response';
import { OpeningScheduleRequest } from '../model/dtos/opening-schedule.dto';
import { PaymentInfoRequest } from '../model/dtos/payment-info.dto';
import { StoreService } from '../services/stores.service';
import { StoresDto } from '../model/dtos/store.dto';
import { Permit } from '../../auth/service/roles.decorator';
import { UserRoles } from '../../users/model/user-roles.enum';
import { StoreCategory } from '../model/enums/store.category';
import { Public } from '../../auth/service/public.decorator';
import {
  FileFieldsInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import { S3Service } from 'src/utils/s3-bucket.service';
import { UploadMerchantDocumentsService } from '../services/upload-merchant-doc.service';
import {
  StoreAppealDto,
  SuspendStoreDto,
  UnsuspendStoreDto,
} from '../model/dtos/suspend-store.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { FeaturedStoreRequest } from '../model/dtos/featured-store.request';
import { FavoriteStoreService } from '../services/favorite-store.service';
import { DeleteStoreDto } from '../model/dtos/delete-store.dto';
import {
  ConfigureStorePasswordDto,
  CreateStoreAccessDto,
  ImportStoreMenuDto,
  ResetStorePasswordDto,
  StorePasswordDto,
} from '../model/dtos/store-access.dto';
import { StoreMenuImportService } from '../services/store-menu-import.service';

@Controller('api/v1/stores')
@Permit([UserRoles.VENDOR, UserRoles.ADMIN])
export class StoresController {
  constructor(
    private readonly storeService: StoreService,
    private readonly s3Service: S3Service,
    private readonly uploadMerchantDocumentsService: UploadMerchantDocumentsService,
    private readonly favoriteStoreService: FavoriteStoreService,
    private readonly storeMenuImportService: StoreMenuImportService,
  ) {}

  @Post('/activate/:category')
  async createStore(
    @Param('category') category: StoreCategory,
    @Body() dto: CreateStoreAccessDto,
  ): Promise<StandardResponse> {
    return await this.storeService.createStore(category, dto);
  }

  @Put('opening-schedule/:storeId')
  async createOrUpdateOpeningSchedule(
    @Param('storeId') storeId: string,
    @Body() openingScheduleDto: OpeningScheduleRequest,
  ): Promise<StandardResponse> {
    return await this.storeService.createOrUpdateOpeningSchedule(
      storeId,
      openingScheduleDto,
    );
  }
  @Get('opening-schedule/:storeId')
  async getOpeningSchedule(
    @Param('storeId') storeId: string,
  ): Promise<StandardResponse> {
    return await this.storeService.getOpeningSchedule(storeId);
  }

  @Post('payment-info/:storeId')
  async createPaymentInfo(
    @Param('storeId') storeId: string,
    @Body() paymentInfoDto: PaymentInfoRequest,
  ): Promise<StandardResponse> {
    return await this.storeService.createOrUpdatePaymentInfo(
      storeId,
      paymentInfoDto,
    );
  }

  @Get('payment-info/:storeId')
  async gapPaymentInfo(
    @Param('storeId') storeId: string,
  ): Promise<StandardResponse> {
    return await this.storeService.getPaymentInfo(storeId);
  }

  @Put(':storeId')
  async updateStore(
    @Param('storeId') storeId: string,
    @Body() storeDto: StoresDto,
  ): Promise<StandardResponse> {
    return await this.storeService.updateStore(storeId, storeDto);
  }

  @Public()
  @SkipThrottle()
  @Header('Cache-Control', 'no-store, max-age=0')
  @Get('public/:storeId')
  async getPublicStore(
    @Param('storeId') storeId: string,
  ): Promise<StandardResponse> {
    const store = await this.storeService.getPublicStoreById(storeId);
    return new StandardResponse(false, 'STORE_FETCHED_SUCCESSFULLY', store);
  }

  @Get('my/stores')
  async getMyStores(): Promise<StandardResponse> {
    return await this.storeService.getMyStores();
  }

  @Post('switch-store/:storeId')
  @Permit([UserRoles.VENDOR])
  async switchStore(
    @Param('storeId') storeId: string,
    @Body() dto: StorePasswordDto,
  ): Promise<StandardResponse> {
    return await this.storeService.switchStore(storeId, dto.password);
  }

  @Post(':storeId/branch-password')
  @Permit([UserRoles.VENDOR])
  async configureStorePassword(
    @Param('storeId') storeId: string,
    @Body() dto: ConfigureStorePasswordDto,
  ): Promise<StandardResponse> {
    return this.storeService.configureStorePassword(storeId, dto);
  }

  @Post(':storeId/branch-password/reset-otp')
  @Permit([UserRoles.VENDOR])
  async requestStorePasswordResetOtp(
    @Param('storeId') storeId: string,
  ): Promise<StandardResponse> {
    return this.storeService.requestStorePasswordResetOtp(storeId);
  }

  @Put(':storeId/branch-password/reset')
  @Permit([UserRoles.VENDOR])
  async resetStorePassword(
    @Param('storeId') storeId: string,
    @Body() dto: ResetStorePasswordDto,
  ): Promise<StandardResponse> {
    return this.storeService.resetStorePassword(storeId, dto);
  }

  @Get(':targetStoreId/menu-import/preview')
  @Permit([UserRoles.VENDOR])
  async previewMenuImport(
    @Param('targetStoreId') targetStoreId: string,
    @Query('sourceStoreId') sourceStoreId: string,
  ): Promise<StandardResponse> {
    return this.storeMenuImportService.preview(sourceStoreId, targetStoreId);
  }

  @Post(':targetStoreId/menu-import')
  @Permit([UserRoles.VENDOR])
  async importMenu(
    @Param('targetStoreId') targetStoreId: string,
    @Body() dto: ImportStoreMenuDto,
  ): Promise<StandardResponse> {
    return this.storeMenuImportService.import(targetStoreId, dto);
  }

  @Post(':storeId/delete-otp')
  @Permit([UserRoles.VENDOR])
  async requestStoreDeletionOtp(
    @Param('storeId') storeId: string,
  ): Promise<StandardResponse> {
    return this.storeService.requestStoreDeletionOtp(storeId);
  }

  @Delete(':storeId')
  @Permit([UserRoles.VENDOR])
  async deleteStore(
    @Param('storeId') storeId: string,
    @Body() dto: DeleteStoreDto,
  ): Promise<StandardResponse> {
    return this.storeService.deleteStore(storeId, dto.otp);
  }

  @SkipThrottle()
  @Permit([UserRoles.ADMIN])
  @Get('admin/stores')
  async adminGetStores(
    @Query('category') category?: StoreCategory,
  ): Promise<StandardResponse> {
    return await this.storeService.adminGetStores(category);
  }
  @Public()
  @SkipThrottle()
  @Header('Cache-Control', 'no-store, max-age=0')
  @Get()
  async getStores(
    @Query('category') category?: StoreCategory,
    @Headers('cushy-access-key') accessKey?: string,
  ): Promise<StandardResponse> {
    return await this.storeService.getStores(category, accessKey);
  }

  @Patch('featured/:storeId')
  @Permit([UserRoles.ADMIN])
  async setFeaturedStore(
    @Param('storeId') storeId: string,
    @Body() request: FeaturedStoreRequest,
  ): Promise<StandardResponse> {
    return this.storeService.setFeaturedStore(storeId, request.isFeatured);
  }

  @Put('favorites/:storeId')
  @Permit([UserRoles.CUSTOMER])
  async addFavorite(@Param('storeId') storeId: string) {
    return this.favoriteStoreService.add(storeId);
  }

  @Delete('favorites/:storeId')
  @Permit([UserRoles.CUSTOMER])
  async removeFavorite(@Param('storeId') storeId: string) {
    return this.favoriteStoreService.remove(storeId);
  }

  @Get('favorites/status/:storeId')
  @Permit([UserRoles.CUSTOMER])
  async favoriteStatus(@Param('storeId') storeId: string) {
    return this.favoriteStoreService.status(storeId);
  }

  @Get('favorites')
  @Permit([UserRoles.CUSTOMER])
  async getFavorites() {
    return this.favoriteStoreService.list();
  }

  @Get(':storeId')
  async getStore(@Param('storeId') storeId: string): Promise<StandardResponse> {
    return await this.storeService.getStore(storeId);
  }

  @Public()
  @Post('upload-images')
  @UseInterceptors(FilesInterceptor('files')) // Note: "files" must match the form-data key
  async uploadImages(@UploadedFiles() files: Express.Multer.File[]) {
    const imageUrls = await this.s3Service.uploadFiles(files);
    return new StandardResponse(false, 'IMAGES_UPLOADED_SUCCESSFULLY', {
      imageUrls,
    });
  }

  @Public()
  @Post('upload-product-images')
  @UseInterceptors(FilesInterceptor('files')) // Note: "files" must match the form-data key
  async uploadProductImages(@UploadedFiles() files: Express.Multer.File[]) {
    const imageUrls = await this.s3Service.uploadProductImages(files);
    return new StandardResponse(false, 'PRODUCT_IMAGES_UPLOADED_SUCCESSFULLY', {
      imageUrls,
    });
  }

  @Public()
  @Post('upload-merchant-documents')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'businessRegistration', maxCount: 1 },
      { name: 'governmentId', maxCount: 1 },
      { name: 'proofOfAddress', maxCount: 1 },
      { name: 'pharmacyLicense', maxCount: 1 },
    ]),
  )
  async uploadDocs(
    @Req() req,
    @UploadedFiles()
    files: {
      businessRegistration?: Express.Multer.File[];
      governmentId?: Express.Multer.File[];
      proofOfAddress?: Express.Multer.File[];
      pharmacyLicense?: Express.Multer.File[];
    },
  ) {
    return this.uploadMerchantDocumentsService.execute({
      businessRegistration: files.businessRegistration?.[0],
      governmentId: files.governmentId?.[0],
      proofOfAddress: files.proofOfAddress?.[0],
      pharmacyLicense: files.pharmacyLicense?.[0],
    });
  }
  @Post('suspend-store/:storeId')
  @Permit([UserRoles.ADMIN])
  async suspendStore(
    @Param('storeId') storeId: string,
    @Body() suspendDto: SuspendStoreDto,
  ): Promise<StandardResponse> {
    return await this.storeService.suspendStore(storeId, suspendDto);
  }
  @Post('unsuspend-store/:storeId')
  @Permit([UserRoles.ADMIN])
  async unsuspendStore(
    @Param('storeId') storeId: string,
    @Body() unsuspendDto: UnsuspendStoreDto,
  ): Promise<StandardResponse> {
    return await this.storeService.unsuspendStore(storeId, unsuspendDto);
  }
  @Post('toggle-store-visibility/:storeId')
  @Permit([UserRoles.VENDOR])
  async toggleStoreVisibility(
    @Param('storeId') storeId: string,
    @Body('isVisible') isVisible: boolean,
  ): Promise<StandardResponse> {
    return await this.storeService.toggleStoreVisibility(storeId, isVisible);
  }

  @Post('suspension-appeal/:storeId')
  @Permit([UserRoles.VENDOR])
  async submitSuspensionAppeal(
    @Param('storeId') storeId: string,
    @Body() appealDto: StoreAppealDto,
  ): Promise<StandardResponse> {
    return await this.storeService.submitSuspensionAppeal(storeId, appealDto);
  }
}

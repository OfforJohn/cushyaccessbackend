import { AdvertisementService } from './advertisement.service';
import { CreateAdvertisementsDto } from './model/create-advertisement.dto';
import { AdvertisementCategory } from './model/advertisement-category.enum';
import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { Permit } from 'src/auth/service/roles.decorator';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { StandardResponse } from '../common/module/standard-response';
import { FilesInterceptor } from '@nestjs/platform-express';
import { S3Service } from 'src/utils/s3-bucket.service';

@Controller('api/v1/advertisements/')
export class AdvertisementController {
  constructor(
    private readonly advertisementService: AdvertisementService,
    private readonly s3Service: S3Service,
  ) {}

  @Post()
  @Permit([UserRoles.ADMIN, UserRoles.VENDOR])
  async createAdvertisement(
    @Body() createAdvertisementsDto: CreateAdvertisementsDto,
  ) {
    return this.advertisementService.createAdvertisement(
      createAdvertisementsDto,
    );
  }

  @Get()
  async getAdvertisements(@Query('category') category: AdvertisementCategory) {
    if (!category) {
      throw new BadRequestException('Category query parameter is required');
    }
    return this.advertisementService.getAdvertisements(category);
  }

  @Delete(':id')
  @Permit([UserRoles.ADMIN, UserRoles.VENDOR])
  async deleteAdvertisement(@Param('id') id: string) {
    return this.advertisementService.deleteAdvertisement(id);
  }

  @Post('upload-images')
  @UseInterceptors(FilesInterceptor('files', 1))
  async uploadImages(@UploadedFiles() files: Express.Multer.File[] | undefined) {
    if (!files?.length) {
      throw new BadRequestException(
        new StandardResponse(true, 'ADVERTISEMENT_IMAGE_REQUIRED'),
      );
    }

    const imageUrls = await this.s3Service.uploadAdsFiles(files);
    return new StandardResponse(false, 'IMAGES_UPLOADED_SUCCESSFULLY', {
      imageUrls,
    });
  }
}

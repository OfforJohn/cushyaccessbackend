import { BadRequestException } from '@nestjs/common';

jest.mock('@nestjs/platform-express', () => ({
  FilesInterceptor: jest.fn(() => class FilesInterceptorMock {}),
}));

import { AdvertisementController } from './advertisement.controller';
import { AdvertisementService } from './advertisement.service';
import { S3Service } from 'src/utils/s3-bucket.service';

describe('AdvertisementController', () => {
  const uploadAdsFiles = jest.fn();
  const controller = new AdvertisementController(
    {} as AdvertisementService,
    { uploadAdsFiles } as unknown as S3Service,
  );

  beforeEach(() => {
    uploadAdsFiles.mockReset();
  });

  describe('uploadImages', () => {
    it('rejects a request without the multipart files field', async () => {
      await expect(controller.uploadImages(undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(uploadAdsFiles).not.toHaveBeenCalled();
    });

    it('uploads the supplied banner file', async () => {
      const file = { originalname: 'banner.webp' } as Express.Multer.File;
      uploadAdsFiles.mockResolvedValueOnce(['https://example.com/banner.webp']);

      const response = await controller.uploadImages([file]);

      expect(uploadAdsFiles).toHaveBeenCalledWith([file]);
      expect(response.toJSON()).toEqual({
        error: false,
        message: 'IMAGES_UPLOADED_SUCCESSFULLY',
        data: { imageUrls: ['https://example.com/banner.webp'] },
        pagination: undefined,
      });
    });
  });
});

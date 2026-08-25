import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { NotificationService } from '../services/notification.service';
import { RegisterTokenDto } from '../dto/register-token.dto';
import { SendSystemNotificationDto } from '../dto/send-system-notification.dto';
import { SendInAppNotificationDto } from '../dto/send-in-app-notification.dto';
import { Request } from 'express';
import { Permit } from 'src/auth/service/roles.decorator';
import { UserRoles } from 'src/users/model/user-roles.enum';

@Controller('api/v1/notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('register')
  async register(
    @Body() registerTokenDto: RegisterTokenDto,
    @Req() req: Request,
  ) {
    try {
      const user = req.user as { id: string };
      return await this.notificationService.registerToken(
        user.id,
        registerTokenDto.token,
        registerTokenDto.deviceName,
        registerTokenDto.fcmToken,
      );
    } catch (error) {
      throw new HttpException(
        { error: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Permit([UserRoles.ADMIN])
  @Get('expo-tokens')
  getTokens() {
    return this.notificationService.getTokens();
  }

  @Permit([UserRoles.ADMIN])
  @Post('send-system')
  async sendSystem(@Body() sendSystemNotificationDto: SendSystemNotificationDto) {
    return this.notificationService.sendSystemNotification(
      sendSystemNotificationDto.title,
      sendSystemNotificationDto.body,
      sendSystemNotificationDto.data,
    );
  }

  @Permit([UserRoles.ADMIN])
  @Post('send-in-app')
  async sendInApp(@Body() sendInAppNotificationDto: SendInAppNotificationDto) {
    return this.notificationService.sendInAppNotification(sendInAppNotificationDto);
  }

  @Post('track-event')
  async trackEvent(
    @Body()
    body: {
      eventType?: string;
      campaignId?: string;
      messageId?: string;
      source?: string;
      data?: Record<string, any>;
    },
    @Req() req: Request,
  ) {
    const user = req.user as { id: string };
    return this.notificationService.trackNotificationEvent(user.id, body);
  }

  @Permit([UserRoles.ADMIN])
  @Post('test/logistics-banner')
  async testLogisticsBanner() {
    return this.notificationService.sendLogisticsBanner();
  }

  @Permit([UserRoles.ADMIN])
  @Post('test/wallet-banner')
  async testWalletBanner() {
    return this.notificationService.sendWalletBanner();
  }
  
  @Permit([UserRoles.ADMIN])
  @Post('test/promo-banner')
  async testPromoBanner() {
    return this.notificationService.sendPromoBanner();
  }
}

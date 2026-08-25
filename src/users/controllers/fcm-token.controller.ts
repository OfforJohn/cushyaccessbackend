import { BadRequestException, Controller, Post, Body, Req } from '@nestjs/common';
import { FCMTokenService } from '../services/fcm-token.service';
import {
  CreateFCMTokenDto,
  DisableFCMTokenDto,
  FCMTokenDto,
} from '../model/dto/fcm-token.dto';
import { StandardResponse } from '../../common/module/standard-response';
import { Request } from 'express';
import { Permit } from '../../auth/service/roles.decorator';
import { UserRoles } from '../model/user-roles.enum';

@Controller('api/v1/fcm-token')
export class FCMTokenController {
  constructor(private readonly fcmTokenService: FCMTokenService) {}

  @Post('create')
  async createToken(
    @Body() createFCMTokenDto: CreateFCMTokenDto,
    @Req() req: Request,
  ) {
    const user = req.user as { id?: string; userId?: string } | undefined;
    const userId = user?.id || user?.userId;

    if (!userId) {
      throw new BadRequestException('User ID is required to register push notification token');
    }

    return await this.fcmTokenService.createToken(
      userId,
      createFCMTokenDto.token,
      createFCMTokenDto.deviceName || 'Unknown Device',
      createFCMTokenDto.fcmToken,
    );
  }

  @Post('disable')
  async disableToken(
    @Body() body: DisableFCMTokenDto,
    @Req() req: Request,
  ) {
    const user = req.user as { id?: string; userId?: string } | undefined;
    const userId = user?.id || user?.userId;
    if (!userId) {
      throw new BadRequestException('Authenticated user is required');
    }
    await this.fcmTokenService.disableToken(userId, body.token);
    return new StandardResponse(false, 'FCM_TOKEN_DISABLED');
  }

  @Post('send')
  @Permit([UserRoles.ADMIN])
  async sendPushNotification(@Body() dto: FCMTokenDto) {
    await this.fcmTokenService.sendPushNotification(dto);
    return new StandardResponse(false, 'PUSH_NOTIFICATION_SENT');
  }
}

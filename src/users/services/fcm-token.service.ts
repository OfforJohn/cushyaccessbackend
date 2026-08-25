import { Injectable, Logger } from '@nestjs/common';
import fetch from 'node-fetch';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FCMToken } from '../model/fcm-token.entity';
import { UsersService } from './users.service';
import { FCMTokenDto } from '../model/dto/fcm-token.dto';
import { StandardResponse } from '../../common/module/standard-response';
import { UserRoles } from '../model/user-roles.enum';
import { Rider, RiderStatus } from '../../riders/model/rider.entity';

type ExpoPushTicket = {
  status?: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
};

@Injectable()
export class FCMTokenService {
  private readonly logger = new Logger(FCMTokenService.name);

  constructor(
    @InjectRepository(FCMToken)
    private readonly fcmTokenRepo: Repository<FCMToken>,
    private readonly usersService: UsersService,
  ) {}

  async createToken(
    userId: string,
    token: string,
    deviceName: string,
    fcmToken?: string,
  ): Promise<StandardResponse> {
    let registration = await this.fcmTokenRepo.findOne({
      where: [
        { token },
        { expoToken: token },
        ...(fcmToken ? [{ fcmToken }] : []),
      ],
    });

    if (!registration) {
      registration = this.fcmTokenRepo.create({
        userId,
        token,
        deviceName,
        expoToken: token,
        fcmToken,
      });
    } else {
      // A device token belongs to one current session. Reassigning it prevents
      // a signed-out user from receiving notifications intended for a new user.
      registration.userId = userId;
      registration.deviceName = deviceName;
      registration.token = token;
      registration.expoToken = token;
      registration.fcmToken = fcmToken;
      registration.isDisabled = false;
    }

    await this.fcmTokenRepo.save(registration);
    return new StandardResponse(false, 'FCM_TOKEN_CREATED', {
      registered: true,
    });
  }

  async disableToken(userId: string, token: string): Promise<void> {
    await this.fcmTokenRepo
      .createQueryBuilder()
      .update(FCMToken)
      .set({ isDisabled: true })
      .where('"userId" = :userId', { userId })
      .andWhere('(token = :token OR "expoToken" = :token)', { token })
      .execute();
  }

  async getActiveExpoTokensByRole(role: UserRoles): Promise<string[]> {
    const tokens = await this.fcmTokenRepo
      .createQueryBuilder('token')
      .innerJoin('token.user', 'user')
      .where('token.isDisabled = false')
      .andWhere('user.userRole = :role', { role })
      .getMany();
    return this.uniqueTokens(tokens);
  }

  async sendPushNotification({
    title,
    subtitle,
    body,
    userIds = [],
    roleBaseSend = false,
    role,
    toAll = false,
    onlineRidersOnly = false,
    data = {},
    sound = 'default',
  }: FCMTokenDto): Promise<void> {
    let registrations: FCMToken[] = [];

    if (onlineRidersOnly) {
      registrations = await this.fcmTokenRepo
        .createQueryBuilder('token')
        .innerJoin(Rider, 'rider', 'rider.userId = token.userId')
        .where('token.isDisabled = false')
        .andWhere('rider.isOnline = true')
        .andWhere('rider.status = :status', { status: RiderStatus.ACTIVE })
        .getMany();
    } else if (toAll) {
      registrations = await this.fcmTokenRepo.find({
        where: { isDisabled: false },
      });
    } else if (roleBaseSend && role) {
      const users = await this.usersService.findByRole(role);
      const roleUserIds = users.map((user) => user.id);
      if (roleUserIds.length > 0) {
        registrations = await this.fcmTokenRepo
          .createQueryBuilder('token')
          .where('token.userId IN (:...userIds)', { userIds: roleUserIds })
          .andWhere('token.isDisabled = false')
          .getMany();
      }
    } else if (userIds.length > 0) {
      registrations = await this.fcmTokenRepo
        .createQueryBuilder('token')
        .where('token.userId IN (:...userIds)', { userIds })
        .andWhere('token.isDisabled = false')
        .getMany();
    }

    const tokens = this.uniqueTokens(registrations).filter((token) =>
      /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token),
    );
    if (tokens.length === 0) {
      const target = userIds.length
        ? `${userIds.length} targeted user(s)`
        : onlineRidersOnly
          ? 'online riders'
          : 'the requested audience';
      this.logger.warn(
        `Push skipped because no active Expo token was registered for ${target}`,
      );
      return;
    }

    await this.sendToTokens(tokens, title, subtitle, body, data, sound);
  }

  private uniqueTokens(registrations: FCMToken[]): string[] {
    return Array.from(
      new Set(
        registrations
          .map((registration) => registration.expoToken ?? registration.token)
          .filter((token): token is string => Boolean(token)),
      ),
    );
  }

  private async sendToTokens(
    tokens: string[],
    title: string,
    subtitle: string | undefined,
    body: string,
    data: Record<string, unknown>,
    sound = 'default',
  ): Promise<void> {
    for (let offset = 0; offset < tokens.length; offset += 100) {
      const batchTokens = tokens.slice(offset, offset + 100);
      const messages = batchTokens.map((token) => ({
        to: token,
        sound,
        title,
        subtitle,
        body,
        priority: 'high',
        channelId: ['NEW_ORDER_AVAILABLE', 'RIDER_ORDER_ASSIGNED'].includes(
          String(data?.route || ''),
        )
          ? 'orders'
          : 'account',
        data: { type: 'SYSTEM', ...data },
      }));

      try {
        const response = await fetch(
          'https://api.expo.dev/v2/push/send?useFcmV1=true',
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Accept-Encoding': 'gzip, deflate',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(messages),
          },
        );
        if (!response.ok) {
          throw new Error(`Expo push API returned HTTP ${response.status}`);
        }

        const result = (await response.json()) as {
          data?: ExpoPushTicket[];
        };
        const invalidTokens = batchTokens.filter(
          (_token, index) =>
            result.data?.[index]?.status === 'error' &&
            result.data?.[index]?.details?.error === 'DeviceNotRegistered',
        );
        if (invalidTokens.length > 0) {
          await this.fcmTokenRepo
            .createQueryBuilder()
            .update(FCMToken)
            .set({ isDisabled: true })
            .where('(token IN (:...tokens) OR "expoToken" IN (:...tokens))', {
              tokens: invalidTokens,
            })
            .execute();
        }
        const ticketErrors = (result.data || [])
          .filter((ticket) => ticket.status === 'error')
          .map(
            (ticket) =>
              ticket.details?.error || ticket.message || 'Unknown Expo error',
          );
        if (ticketErrors.length > 0) {
          this.logger.warn(
            `Expo rejected ${ticketErrors.length}/${batchTokens.length} push ticket(s): ${Array.from(new Set(ticketErrors)).join(', ')}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to send Expo push batch (${batchTokens.length} recipients)`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }
}

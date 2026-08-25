import { Injectable, Logger } from '@nestjs/common';
import { FCMTokenService } from 'src/users/services/fcm-token.service';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { AnalyticsService } from 'src/analytics/analytics.service';

@Injectable()
export class NotificationService {
  constructor(
    private readonly fcmTokenService: FCMTokenService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  private readonly logger = new Logger(NotificationService.name);
  private expoTokens = new Set<string>();

  async registerToken(
    userId: string,
    token: string,
    deviceName?: string,
    fcmToken?: string,
  ) {
    if (!/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token)) {
      throw new Error('Invalid Expo token');
    }

    this.expoTokens.add(token);
    this.logger.log(`📲 Registered devices: ${this.expoTokens.size}`);

    return await this.fcmTokenService.createToken(
      userId,
      token,
      deviceName || 'Unknown Device',
      fcmToken,
    );
  }

  private async getCustomerExpoTokens(): Promise<string[]> {
    return this.fcmTokenService.getActiveExpoTokensByRole(UserRoles.CUSTOMER);
  }

  getTokens(): Promise<{ tokens: string[] }> {
    return this.getCustomerExpoTokens().then((tokens) => ({ tokens }));
  }

  async trackNotificationEvent(
    userId: string,
    eventData: {
      eventType?: string;
      campaignId?: string;
      messageId?: string;
      source?: string;
      data?: Record<string, any>;
    },
  ) {
    const eventType =
      eventData.eventType === 'received'
        ? 'notification_received'
        : 'notification_opened';

    const activity = await this.analyticsService.trackUserActivity(
      userId,
      eventType,
      {
        campaignId: eventData.campaignId || null,
        messageId: eventData.messageId || null,
        source: eventData.source || 'firebase',
        data: eventData.data || {},
      },
    );

    return {
      tracked: true,
      id: activity.id,
    };
  }

  async sendSystemNotification(
    title?: string,
    body?: string,
    data?: Record<string, any>,
  ) {
    const tokens = await this.getCustomerExpoTokens();
    const messages = tokens.map((token) => ({
      to: token,
      sound: 'default' as const,
      title: title || 'System Notification',
      body: body || 'This is a system notification',
      data: { ...data, type: 'SYSTEM' },
    }));

    if (!messages.length) {
      return { sent: 0 };
    }

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    const responseData = await response.json();
    return { sent: messages.length, data: responseData };
  }

  async sendInAppNotification(notificationData: any) {
    // Only include non-null values
    const data = {
      type: 'IN_APP',
      title: notificationData.title || 'Notification',
      ...(notificationData.subtitle && { subtitle: notificationData.subtitle }),
      ...(notificationData.description && { description: notificationData.description }),
      ...(notificationData.icon && { icon: notificationData.icon }),
      ...(notificationData.backgroundColor && { backgroundColor: notificationData.backgroundColor }),
      ...(notificationData.image && { image: notificationData.image }),
      ...(notificationData.badges && Array.isArray(notificationData.badges) && { badges: JSON.stringify(notificationData.badges) }),
      ...(notificationData.features && Array.isArray(notificationData.features) && { features: JSON.stringify(notificationData.features) }),
      ...(notificationData.cta && { cta: JSON.stringify(notificationData.cta) }),
      ...(notificationData.route && { route: notificationData.route }),
      ...(notificationData.url && { url: notificationData.url }),
    };

    const tokens = await this.getCustomerExpoTokens();
    const messages = tokens.map((token) => ({
      to: token,
      sound: null,
      priority: 'high' as const,
      data,
    }));

    this.logger.log(`Sending notification to ${messages.length} device(s)`);
    this.logger.log(`Notification data: ${JSON.stringify(data, null, 2)}`);

    if (!messages.length) {
      return { sent: 0 };
    }

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    const responseData = await response.json();
    return { sent: messages.length, data: responseData };
  }

  async sendLogisticsBanner() {
    const tokens = await this.getCustomerExpoTokens();
    const messages = tokens.map((token) => ({
      to: token,
      sound: null,
      priority: 'high' as const,
      data: {
        type: 'IN_APP',
        title: 'New Logistics Feature',
        subtitle: 'Send packages faster',
        description: 'Experience lightning-fast package delivery with real-time tracking',
        icon: 'truck',
        backgroundColor: 'green',
        badges: JSON.stringify(['New', 'Available Now']),
        features: JSON.stringify([
          { icon: 'truck', text: 'Express Delivery', color: '#10B981' },
          { icon: 'shield', text: 'Full Coverage', color: '#3B82F6' },
          { icon: 'lightning', text: 'Real-time Tracking', color: '#F59E0B' },
          { icon: 'star', text: 'Dedicated Support', color: '#8B5CF6' },
        ]),
        cta: JSON.stringify({ text: 'Explore Features', icon: 'arrow-forward' }),
        route: '/(logistics)',
      },
    }));

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    const responseData = await response.json();
    return { sent: messages.length, data: responseData };
  }

  async sendWalletBanner() {
    const tokens = await this.getCustomerExpoTokens();
    const messages = tokens.map((token) => ({
      to: token,
      sound: null,
      priority: 'high' as const,
      data: {
        type: 'IN_APP',
        title: 'Wallet Upgrade Available',
        subtitle: 'Enhanced features unlocked',
        description: 'Enjoy seamless transactions with new payment methods',
        icon: 'wallet',
        backgroundColor: 'purple',
        badges: JSON.stringify(['Premium', 'Limited Offer']),
        features: JSON.stringify([
          { icon: 'send', text: 'Send Globally', color: '#8B5CF6' },
          { icon: 'shield', text: 'Bank-Level Security', color: '#6366F1' },
          { icon: 'discount', text: 'Zero Fees', color: '#A855F7' },
          { icon: 'heart', text: 'Rewards Program', color: '#D946EF' },
        ]),
        cta: JSON.stringify({ text: 'Upgrade Now', icon: 'arrow-forward' }),
        route: '/(wallet)',
      },
    }));

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    const responseData = await response.json();
    return { sent: messages.length, data: responseData };
  }

  async sendPromoBanner() {
    const tokens = await this.getCustomerExpoTokens();
    const messages = tokens.map((token) => ({
      to: token,
      sound: null,
      priority: 'high' as const,
      data: {
        type: 'IN_APP',
        title: 'Special Promotion',
        subtitle: 'Limited time only',
        description: 'Get up to 50% off on your next purchase',
        icon: 'gift',
        backgroundColor: 'blue',
        badges: JSON.stringify(['50% OFF', 'Ends Today']),
        features: JSON.stringify([
          { icon: 'discount', text: '50% Discount', color: '#2563EB' },
          { icon: 'gift', text: 'Free Shipping', color: '#0EA5E9' },
          { icon: 'star', text: 'Loyalty Points', color: '#06B6D4' },
        ]),
        cta: JSON.stringify({ text: 'Claim Offer', icon: 'gift' }),
        route: '/',
      },
    }));

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    const responseData = await response.json();
    return { sent: messages.length, data: responseData };
  }
}

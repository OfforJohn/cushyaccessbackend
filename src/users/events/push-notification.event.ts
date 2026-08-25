import { NotificationCategory } from '../model/notification-category';

export class PushNotificationEvent {
  constructor(
    public readonly userId: string,
    public readonly notificationCategory: NotificationCategory,
    public readonly additionalInfo?: string,
    public readonly sound?: string,
    public readonly deepLink?: string,
  ) {}
}

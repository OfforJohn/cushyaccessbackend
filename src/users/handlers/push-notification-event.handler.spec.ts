import { PushNotificationEvent } from '../events/push-notification.event';
import {
  NotificationCategory,
  NotificationRoutes,
} from '../model/notification-category';
import { PushNotificationEventHandler } from './push-notification-event.handler';

describe('PushNotificationEventHandler rider verification', () => {
  it('sends a rejected-document alert to the rider verification route', async () => {
    const fcmTokenService = {
      sendPushNotification: jest.fn().mockResolvedValue(undefined),
    };
    const handler = new PushNotificationEventHandler(fcmTokenService as never);

    await handler.handle(
      new PushNotificationEvent(
        'user_1',
        NotificationCategory.RIDER_DOCUMENT_REJECTED,
        'Your NIN slip was rejected. Reason: Blurred',
      ),
    );

    expect(fcmTokenService.sendPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['user_1'],
        title: 'Document needs attention',
        body: 'Your NIN slip was rejected. Reason: Blurred',
        data: expect.objectContaining({
          route: 'RIDER_VERIFICATION',
          verificationEvent: 'document_rejected',
        }),
      }),
    );
  });

  it('routes merchant order taps to the vendor order dashboard', async () => {
    const fcmTokenService = {
      sendPushNotification: jest.fn().mockResolvedValue(undefined),
    };
    const handler = new PushNotificationEventHandler(fcmTokenService as never);

    await handler.handle(
      new PushNotificationEvent(
        'vendor_1',
        NotificationCategory.VENDOR_RECEIVE_ORDER,
        'NGN 5,000',
      ),
    );

    expect(NotificationRoutes.VENDOR_RECEIVE_ORDER).toBe('/vendor/(tabs)');
    expect(fcmTokenService.sendPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['vendor_1'],
        data: expect.objectContaining({ route: '/vendor/(tabs)' }),
      }),
    );
  });

  it('includes the customer rider note in a new-order push payload', async () => {
    const fcmTokenService = {
      sendPushNotification: jest.fn().mockResolvedValue(undefined),
    };
    const handler = new PushNotificationEventHandler(fcmTokenService as never);

    await handler.handle(
      new PushNotificationEvent(
        'rider_1',
        NotificationCategory.NEW_ORDER_AVAILABLE,
        JSON.stringify({
          orderId: 'order_1',
          noteForRider: 'Please call at the gate.',
          message: 'New delivery. Customer note: Please call at the gate.',
        }),
      ),
    );

    expect(fcmTokenService.sendPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['rider_1'],
        body: expect.stringContaining('Please call at the gate.'),
        data: expect.objectContaining({
          route: 'NEW_ORDER_AVAILABLE',
          orderId: 'order_1',
          noteForRider: 'Please call at the gate.',
        }),
      }),
    );
  });

  it('routes an administrator-assigned order to the active delivery', async () => {
    const fcmTokenService = {
      sendPushNotification: jest.fn().mockResolvedValue(undefined),
    };
    const handler = new PushNotificationEventHandler(fcmTokenService as never);

    await handler.handle(
      new PushNotificationEvent(
        'rider_1',
        NotificationCategory.NEW_ORDER_AVAILABLE,
        JSON.stringify({
          orderId: 'order_1',
          assigned: true,
          deliveryDescription: '2x Jollof Rice',
        }),
      ),
    );

    expect(fcmTokenService.sendPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['rider_1'],
        title: 'Delivery Assigned',
        body: 'A delivery has been assigned to you. Tap to review.',
        data: expect.objectContaining({
          route: 'RIDER_ORDER_ASSIGNED',
          assigned: true,
          orderId: 'order_1',
        }),
      }),
    );
    expect(
      fcmTokenService.sendPushNotification.mock.calls[0][0].data,
    ).not.toHaveProperty('deliveryDescription');
  });
});

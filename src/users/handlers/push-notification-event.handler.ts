import { Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { PushNotificationEvent } from '../events/push-notification.event';
import { FCMTokenService } from '../services/fcm-token.service';
import { FCMTokenDto } from '../model/dto/fcm-token.dto';
import { NotificationRoutes } from '../model/notification-category';

@EventsHandler(PushNotificationEvent)
export class PushNotificationEventHandler implements IEventHandler<PushNotificationEvent> {
  private readonly logger = new Logger(PushNotificationEventHandler.name);

  constructor(private readonly fcmTokenService: FCMTokenService) {}

  async handle(pushNotificationEvent: PushNotificationEvent) {
    const {
      notificationCategory,
      additionalInfo,
      userId,
      sound,
    } = // 👈 Add sound here
      pushNotificationEvent;

    this.logger.debug(
      `Processing ${notificationCategory} push for one target user`,
    );

    let data: FCMTokenDto | null = null;

    switch (notificationCategory) {
      case 'NEW_ORDER_AVAILABLE': {
        const orderInfo = this.safeParseAdditionalInfo(additionalInfo);
        const isAssignedOrder = Boolean(orderInfo.assigned);
        data = {
          title: isAssignedOrder
            ? 'Delivery Assigned'
            : '📦 New Order Available!',
          subtitle: isAssignedOrder ? 'Active Delivery' : 'Delivery Request',
          body:
            String(orderInfo.message || '') ||
            (isAssignedOrder
              ? 'A delivery has been assigned to you. Tap to review.'
              : 'A new delivery order has been placed nearby.'),
          data: {
            route: isAssignedOrder
              ? 'RIDER_ORDER_ASSIGNED'
              : 'NEW_ORDER_AVAILABLE',
            assigned: isAssignedOrder,
            orderId: orderInfo.orderId,
            noteForRider: orderInfo.noteForRider,
            customerName: orderInfo.customerName,
            customerPhone: orderInfo.customerPhone,
            deliveryAddress: orderInfo.deliveryAddress,
          },
          onlineRidersOnly: userId === 'ONLINE_RIDERS',
        };
        break;
      }
      case 'USER_RECEIVE_FUND_VIA_IN_APP_TRANSFER':
        data = {
          title: '💸 Cushy Coins Received',
          subtitle: 'In-App Transfer',
          body: `You have received cushy coins via In-App Transfer from ${additionalInfo ?? 'A friend'}.`,
          data: {
            route: NotificationRoutes.USER_RECEIVE_FUND_VIA_IN_APP_TRANSFER,
          },
        };
        break;
      case 'VENDOR_RECEIVE_FUND_VIA_IN_APP_TRANSFER':
        data = {
          title: '💸 Cushy Coins Received',
          subtitle: 'In-App Transfer',
          body: `You have received cushy coins via In-App Transfer from ${additionalInfo ?? 'A friend'}.`,
          data: {
            route: NotificationRoutes.VENDOR_RECEIVE_FUND_VIA_IN_APP_TRANSFER,
          },
        };
        break;
      case 'USER_RECEIVE_FUND_VIA_PAYSTACK_WEBHOOK':
        data = {
          title: '🏦 Cushy Coins Received',
          subtitle: 'Bank Transfer',
          body: `You have received cushy coins via bank transfer from ${additionalInfo ?? 'A friend'}.`,
          data: {
            route: NotificationRoutes.USER_RECEIVE_FUND_VIA_PAYSTACK_WEBHOOK,
          },
        };
        break;
      case 'VENDOR_RECEIVE_FUND_VIA_PAYSTACK_WEBHOOK':
        data = {
          title: '🏦 Cushy Coins Received',
          subtitle: 'Bank Transfer',
          body: `You have received cushy coins via bank transfer from ${additionalInfo ?? 'A friend'}.`,
          data: {
            route: NotificationRoutes.VENDOR_RECEIVE_FUND_VIA_PAYSTACK_WEBHOOK,
          },
        };
        break;
      case 'VENDOR_RECEIVE_ORDER':
        data = {
          title: '🛒 New Order',
          subtitle: 'Vendor',
          body: `You have received a new order of ${additionalInfo ?? 'N***'}.`,
          data: {
            route: NotificationRoutes.VENDOR_RECEIVE_ORDER,
          },
        };
        break;
      case 'ORDER_REFUND':
        data = {
          title: '💰 Order Refunded',
          subtitle: 'Refund',
          body: 'Your order has been refunded.',
          data: {
            route: NotificationRoutes.ORDER_REFUND,
          },
        };
        break;
      case 'VENDOR_ORDER_REWARD':
        data = {
          title: '🏅 Order Reward',
          subtitle: 'Vendor',
          body: 'You have received a reward for your order.',
          data: {
            route: NotificationRoutes.VENDOR_ORDER_REWARD,
          },
        };
        break;
      case 'ORDER_PICKED_UP':
        data = {
          title: '🚚 Order Picked Up',
          subtitle: 'Get Ready',
          body: "Your order has been picked up, and on it's way.",
          data: {
            route: NotificationRoutes.ORDER_PICKED_UP,
          },
        };
        break;
      case 'ORDER_CANCELLED':
        data = {
          title: '❌ Order Cancelled',
          subtitle: 'Order',
          body: 'Your order has been cancelled.',
          data: {
            route: NotificationRoutes.ORDER_CANCELLED,
          },
        };
        break;
      case 'ORDER_DELIVERED':
        data = {
          title: '📦 Order Delivered',
          subtitle: 'Delivery',
          body: 'Your order has been delivered.',
          data: {
            route: NotificationRoutes.ORDER_DELIVERED,
          },
        };
        break;
      case 'VENDOR_CREDENTIAL_APPROVED':
        data = {
          title: "You're Verified 🎉",
          subtitle: 'Verification',
          body: 'Your vendor credentials have been approved.',
          data: {
            route: NotificationRoutes.VENDOR_CREDENTIAL_APPROVED,
          },
        };
        break;
      case 'IMMEDIATE_CONSULTATION_REQUEST':
        const consultInfo = JSON.parse(
          pushNotificationEvent.additionalInfo || '{}',
        );
        data = {
          title: '📞 Immediate Consultation Request',
          subtitle: 'Consultation',
          body: `${consultInfo.patientName || 'Patient'} is requesting a ${consultInfo.consultationType || consultInfo.specialty || 'consultation'}`,
          data: {
            route: NotificationRoutes.IMMEDIATE_CONSULTATION_REQUEST,
            type: 'SYSTEM',
            // 🔗 Deep link for direct navigation
            deepLink:
              pushNotificationEvent.deepLink || consultInfo.deepLink || '',
            // Screen params
            screen: 'ConsultationRequest',
            appointmentId: consultInfo.appointmentId,
            patientId: consultInfo.patientId,
            patientName: consultInfo.patientName,
            consultationType:
              consultInfo.consultationType || consultInfo.specialty,
            patientEmail: consultInfo.patientEmail,
            doctorId: consultInfo.doctorId,
            roomId: consultInfo.roomId,
            meetingLink: consultInfo.doctorMeetingLink,
            consultationFee: consultInfo.consultationFee,
            symptoms: consultInfo.symptoms,
            specialty: consultInfo.specialty,
            urgency: consultInfo.urgency,
            action: 'accept_reject',
            requiresImmediateAction: true,
            timestamp: new Date().toISOString(),
          },
        };
        break;
      case 'DOCTOR_NEW_APPOINTMENT': {
        const appointmentInfo = this.safeParseAdditionalInfo(
          pushNotificationEvent.additionalInfo,
        );
        data = {
          title: '📅 Appointment Booked',
          subtitle: 'New Appointment',
          body:
            appointmentInfo.message ||
            appointmentInfo.body ||
            'You have a new scheduled appointment.',
          data: {
            route: NotificationRoutes.DOCTOR_NEW_APPOINTMENT,
            type: 'SYSTEM',
            tab: 'scheduled',
            appointmentId: appointmentInfo.appointmentId,
            patientId: appointmentInfo.patientId,
            patientName: appointmentInfo.patientName,
            appointmentDate: appointmentInfo.appointmentDate,
            appointmentTime: appointmentInfo.appointmentTime,
            consultationType: appointmentInfo.consultationType,
          },
        };
        break;
      }
      case 'APPOINTMENT_REMINDER': {
        const reminderInfo = this.safeParseAdditionalInfo(
          pushNotificationEvent.additionalInfo,
        );
        data = {
          title:
            reminderInfo.reminderType === 'start'
              ? 'Consultation Starts Now'
              : 'Appointment Reminder',
          subtitle: 'Health Consultation',
          body:
            reminderInfo.body ||
            'You have an upcoming consultation appointment.',
          data: {
            route: NotificationRoutes.APPOINTMENT_REMINDER,
            type: 'SYSTEM',
            tab: 'upcoming',
            appointmentId: reminderInfo.appointmentId,
            appointmentDate: reminderInfo.appointmentDate,
            appointmentTime: reminderInfo.appointmentTime,
            meetingLink: reminderInfo.meetingLink,
            reminderType: reminderInfo.reminderType,
          },
        };
        break;
      }
      case 'DOCTOR_APPOINTMENT_REMINDER': {
        const reminderInfo = this.safeParseAdditionalInfo(
          pushNotificationEvent.additionalInfo,
        );
        data = {
          title:
            reminderInfo.reminderType === 'start'
              ? 'Consultation Starts Now'
              : 'Appointment Reminder',
          subtitle: 'Scheduled Consultation',
          body:
            reminderInfo.body || 'You have an upcoming scheduled consultation.',
          data: {
            route: NotificationRoutes.DOCTOR_APPOINTMENT_REMINDER,
            type: 'SYSTEM',
            tab: 'scheduled',
            appointmentId: reminderInfo.appointmentId,
            appointmentDate: reminderInfo.appointmentDate,
            appointmentTime: reminderInfo.appointmentTime,
            meetingLink: reminderInfo.meetingLink,
            reminderType: reminderInfo.reminderType,
          },
        };
        break;
      }
      case 'APPOINTMENT_REJECTED': {
        const rejectionInfo = this.safeParseAdditionalInfo(
          pushNotificationEvent.additionalInfo,
        );
        data = {
          title: 'Appointment Declined',
          subtitle: 'Health Consultation',
          body:
            rejectionInfo.body ||
            rejectionInfo.message ||
            'Your appointment has been declined by the doctor.',
          data: {
            route: NotificationRoutes.APPOINTMENT_REJECTED,
            type: 'SYSTEM',
            tab: 'past',
            appointmentId: rejectionInfo.appointmentId,
          },
        };
        break;
      }
      case 'CONSULTATION_STARTED': {
        const consultInfo = JSON.parse(
          pushNotificationEvent.additionalInfo || '{}',
        );
        data = {
          title: 'Consultation Accepted',
          subtitle: 'Video session',
          body: consultInfo.doctorName
            ? `${consultInfo.doctorName} accepted your request.`
            : 'Your consultation has started.',
          data: {
            route: NotificationRoutes.CONSULTATION_STARTED,
            type: 'SYSTEM',
            appointmentId: consultInfo.appointmentId,
            meetingLink: consultInfo.meetingLink,
            doctorId: consultInfo.doctorId,
            doctorName: consultInfo.doctorName,
            roomId: consultInfo.roomId,
          },
        };
        break;
      }
      case 'CONSULTATION_CANCELLED': {
        const consultInfo = JSON.parse(
          pushNotificationEvent.additionalInfo || '{}',
        );
        data = {
          title: 'Consultation Cancelled',
          subtitle: 'Request update',
          body:
            consultInfo.cancelledBy === 'SYSTEM'
              ? 'This consultation request was closed because another doctor accepted it.'
              : consultInfo.patientName
                ? `${consultInfo.patientName} cancelled the consultation request.`
                : 'The consultation request was cancelled.',
          data: {
            route: NotificationRoutes.CONSULTATION_CANCELLED,
            type: 'SYSTEM',
            appointmentId: consultInfo.appointmentId,
          },
        };
        break;
      }
      case 'CONSULTATION_EXPIRED': {
        const consultInfo = this.safeParseAdditionalInfo(
          pushNotificationEvent.additionalInfo,
        );
        const recipientRole = String(
          consultInfo.recipientRole || '',
        ).toUpperCase();
        const isDoctorRecipient = recipientRole === 'DOCTOR';

        data = {
          title: 'Consultation Expired',
          subtitle: 'No response in time',
          body:
            consultInfo.body ||
            consultInfo.message ||
            (consultInfo.reason
              ? 'The appointment expired because no session was joined.'
              : 'The consultation request expired after 5 minutes.'),
          data: {
            route: isDoctorRecipient
              ? '/Doctors/(tabs)?tab=cancelled'
              : NotificationRoutes.CONSULTATION_EXPIRED,
            type: 'SYSTEM',
            tab: isDoctorRecipient ? 'cancelled' : 'past',
            appointmentId: consultInfo.appointmentId,
          },
        };
        break;
      }
      case 'CONSULTATION_COMPLETED': {
        const consultInfo = JSON.parse(
          pushNotificationEvent.additionalInfo || '{}',
        );
        data = {
          title: 'Consultation Completed',
          subtitle: 'Summary ready',
          body: 'Your consultation summary is ready.',
          data: {
            route: NotificationRoutes.CONSULTATION_COMPLETED,
            type: 'SYSTEM',
            appointmentId: consultInfo.appointmentId,
          },
        };
        break;
      }
      case 'VENDOR_CREDENTIAL_REJECTED':
        data = {
          title: 'Credentials Rejected ❌',
          subtitle: 'Verification',
          body: 'Your vendor credentials have been rejected.',
          data: {
            route: NotificationRoutes.VENDOR_CREDENTIAL_REJECTED,
          },
        };
        break;
      case 'VENDOR_ACCEPT_ORDER':
        data = {
          title: 'Order accepted',
          subtitle: 'Merchant update',
          body: 'The merchant accepted your order and rider assignment has started.',
          data: {
            route: NotificationRoutes.ORDER_STATUS,
            status: 'ACKNOWLEDGED',
          },
        };
        break;
      case 'VENDOR_REJECT_ORDER':
        data = {
          title: 'Order declined',
          subtitle: 'Merchant update',
          body: 'The merchant could not accept your order. Open the app for refund details.',
          data: {
            route: NotificationRoutes.ORDER_STATUS,
            status: 'REJECTED',
          },
        };
        break;
      case 'RIDER_DOCUMENT_VERIFIED': {
        const riderInfo = this.safeParseAdditionalInfo(additionalInfo);
        data = {
          title: 'Document approved',
          subtitle: 'Rider verification',
          body:
            String(riderInfo.message || '') ||
            additionalInfo ||
            'One of your rider documents has been approved.',
          data: {
            route: NotificationRoutes.RIDER_VERIFICATION,
            verificationEvent: 'document_verified',
          },
        };
        break;
      }
      case 'RIDER_DOCUMENT_REJECTED': {
        const riderInfo = this.safeParseAdditionalInfo(additionalInfo);
        data = {
          title: 'Document needs attention',
          subtitle: 'Rider verification',
          body:
            String(riderInfo.message || '') ||
            additionalInfo ||
            'A rider document was rejected. Open the app to review the reason and upload a replacement.',
          data: {
            route: NotificationRoutes.RIDER_VERIFICATION,
            verificationEvent: 'document_rejected',
          },
        };
        break;
      }
      case 'RIDER_BACKGROUND_CHECK_APPROVED':
        data = {
          title: 'Background check approved',
          subtitle: 'Rider verification',
          body:
            additionalInfo ||
            'Your background check has been approved. Open the app to see your next step.',
          data: {
            route: NotificationRoutes.RIDER_VERIFICATION,
            verificationEvent: 'background_check_approved',
          },
        };
        break;
      case 'RIDER_BACKGROUND_CHECK_REJECTED':
        data = {
          title: 'Background check needs attention',
          subtitle: 'Rider verification',
          body:
            additionalInfo ||
            'Your background check could not be approved. Contact support for the next step.',
          data: {
            route: NotificationRoutes.RIDER_VERIFICATION,
            verificationEvent: 'background_check_rejected',
          },
        };
        break;
      case 'RIDER_TRAINING_COMPLETED':
        data = {
          title: 'Training completed',
          subtitle: 'Rider verification',
          body:
            additionalInfo ||
            'Your rider training has been marked complete. Open the app to see your account status.',
          data: {
            route: NotificationRoutes.RIDER_VERIFICATION,
            verificationEvent: 'training_completed',
          },
        };
        break;
      case 'RIDER_STATUS_CHANGED':
        data = {
          title: 'Rider account update',
          subtitle: 'Verification status',
          body: additionalInfo || 'Your rider account status has changed.',
          data: {
            route: NotificationRoutes.RIDER_VERIFICATION,
            verificationEvent: 'status_changed',
          },
        };
        break;
      case 'BIRTHDAY_REWARD': {
        const birthdayInfo = this.safeParseAdditionalInfo(
          pushNotificationEvent.additionalInfo,
        );
        data = {
          title: 'Happy birthday! 🎉',
          subtitle: 'A gift from Cushy Access',
          body: birthdayInfo.code
            ? `Use ${birthdayInfo.code} for 5% off. It expires in 48 hours.`
            : 'Your one-time 5% birthday discount is ready.',
          data: {
            route: NotificationRoutes.BIRTHDAY_REWARD,
            type: 'SYSTEM',
            couponCode: birthdayInfo.code,
            expiresAt: birthdayInfo.expiresAt,
          },
        };
        break;
      }
      default:
        data = {
          title: '🔔 Notification',
          subtitle: '',
          body: 'You have a new notification.',
          data: {
            route: '/',
          },
        };
        break;
    }

    const notificationPayload = {
      ...data,
      ...(userId === 'ONLINE_RIDERS' ? {} : { userIds: [userId] }),
    };

    if (sound) {
      notificationPayload.sound = sound || 'default';
    }

    try {
      await this.fcmTokenService.sendPushNotification(notificationPayload);
      this.logger.log(`Processed ${notificationCategory} push dispatch`);
    } catch (error) {
      this.logger.error(
        `Failed to process ${notificationCategory} push dispatch`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private safeParseAdditionalInfo(
    additionalInfo?: string | null,
  ): Record<string, any> {
    if (!additionalInfo) return {};

    try {
      const parsed = JSON.parse(additionalInfo);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return { message: additionalInfo };
    }
  }
}

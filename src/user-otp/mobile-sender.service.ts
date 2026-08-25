import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import axios from 'axios';
import { OtpPurpose } from './model/otp-purpose.enum';

interface AppointmentSmsData {
  patientName: string;
  doctorName: string;
  patientCallingCode?: string;
  doctorCallingCode?: string;
  appointmentDay: string;
  appointmentDate: string;
  appointmentTime: string;
  consultationFee: number;
}

interface ConsultationRequestSmsData {
  doctorName: string;
  doctorCallingCode?: string;
  patientName: string;
  symptoms: string;
  appointmentId: string;
}

interface AppointmentReminderSmsData {
  patientName: string;
  patientCallingCode?: string;
  doctorName: string;
  appointmentDate: string;
  appointmentTime: string;
  reminderType: '24-hour' | '1-hour';
}

interface RiderAssignmentSmsData {
  riderName: string;
  riderCallingCode?: string;
  customerName: string;
  customerPhone?: string;
  customerCallingCode?: string;
  deliveryAddress?: string | null;
  riderNote?: string | null;
  pickupName: string;
  pickupLocation: string;
  pickupPhone?: string;
  pickupCallingCode?: string;
  pickupTypeLabel?: string;
}

class SmsProviderRejectedError extends Error {}

const TERMII_SMS_URL = 'https://v3.api.termii.com/api/sms/send';
const TERMII_SENDER_ID = 'OE ALERT';
const TERMII_CHANNEL = 'dnd';
const TERMII_TIMEOUT_MS = 15_000;

@Injectable()
export class MobileSenderService {
  private client: Twilio;
  private readonly logger = new Logger(MobileSenderService.name);
  private readonly termiiApiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.termiiApiKey =
      this.configService.get<string>('TERMI_SMS_API_KEY') || '';
    this.client = new Twilio(
      this.configService.get('TWILIO_ACCOUNT_SID'),
      this.configService.get('TWILIO_AUTH_TOKEN'),
    );
  }

  private formatPhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');

    if (cleaned.startsWith('00')) {
      cleaned = cleaned.substring(2);
    }
    if (cleaned.startsWith('234')) {
      return cleaned.substring(3).replace(/^0/, '');
    }
    if (cleaned.startsWith('0')) {
      return cleaned.substring(1);
    }

    return cleaned;
  }

  private formatSmsDestination(mobile: string, callingCode = '234'): string {
    const original = (mobile || '').trim();
    if (!original) throw new Error('SMS destination is required');

    const code = (callingCode || '234').replace(/\D/g, '') || '234';
    let number = original.replace(/\D/g, '');
    if (!number) throw new Error('SMS destination is invalid');
    if (original.startsWith('+')) return number;
    if (number.startsWith('00')) return number.slice(2);
    if (number.startsWith(code)) return number;
    number = number.replace(/^0+/, '');
    return `${code}${number}`;
  }

  private formatRecipientName(name: string): string {
    const normalized = (name || '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/^dear\s+/i, '')
      .replace(/^[,.:;!\s]+|[,.:;!\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) throw new Error('SMS recipient name is required');
    return normalized;
  }

  private formatDoctorName(name: string): string {
    const normalized = this.formatRecipientName(name);
    const withoutTitle = normalized.replace(/^(?:dr\.?\s*)+/i, '').trim();
    if (!withoutTitle || withoutTitle === 'Doctor') {
      throw new Error('Doctor name is required for SMS delivery');
    }
    return `Dr. ${withoutTitle}`;
  }

  private formatDeliveryAddress(address?: string | null): string {
    const normalized = (address || '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      !normalized ||
      normalized.toLowerCase() === 'null' ||
      normalized.toLowerCase() === 'undefined'
    ) {
      return 'the address provided in the Cushy Access app';
    }
    return normalized;
  }

  private greeting(name: string): string {
    return `Dear ${this.formatRecipientName(name)},`;
  }

  private formatPhoneForMessage(phone: string, callingCode = '234'): string {
    const number = this.formatSmsDestination(phone, callingCode);
    return number.startsWith('234') ? `0${number.slice(3)}` : `+${number}`;
  }

  private async sendTermiiSms(
    mobile: string,
    sms: string,
    callingCode = '234',
  ) {
    if (!this.termiiApiKey) throw new Error('Termii API key is not configured');

    const normalizedSms = sms.replace(/\s+/g, ' ').trim();
    if (!/^Dear\s+[^,]+,\s/.test(normalizedSms)) {
      throw new Error('Termii SMS must begin with the recipient name');
    }

    const response = await axios.post(
      TERMII_SMS_URL,
      {
        to: this.formatSmsDestination(mobile, callingCode),
        from: TERMII_SENDER_ID,
        sms: normalizedSms,
        type: 'plain',
        api_key: this.termiiApiKey,
        channel: TERMII_CHANNEL,
      },
      {
        timeout: TERMII_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    if (!response.data?.message_id) {
      throw new SmsProviderRejectedError('SMS provider rejected the message');
    }
    return response.data;
  }

  private logSmsFailure(messageType: string, error: unknown): void {
    const status = axios.isAxiosError(error) ? error.response?.status : null;
    const reason =
      error instanceof Error && error.message
        ? error.message
        : 'Unknown SMS delivery error';
    this.logger.error(
      `${messageType} SMS delivery failed${status ? ` (HTTP ${status})` : ''}: ${reason}`,
    );
  }

  private canSafelyTryFallback(error: unknown): boolean {
    return (
      error instanceof SmsProviderRejectedError ||
      (axios.isAxiosError(error) && Boolean(error.response))
    );
  }

  async sendWhatsappMessage(to: string, otpCode: number) {
    try {
      const formattedNumber = this.formatPhoneNumber(to);
      const twillioNumber = this.configService.get<string>(
        'TWILIO_PHONE_NUMBER',
      );
      const response = await this.client.messages.create({
        from: `whatsapp:${twillioNumber}`,
        to: `whatsapp:${formattedNumber}`,
        contentSid: this.configService.get<string>('TWILIO_CONTENT_SID'),
        contentVariables: JSON.stringify({ 1: String(otpCode) }),
      });

      return response;
    } catch (error) {
      console.error('Error sending WhatsApp message:', error);
    }
  }

  async sendSms(
    mobile: string,
    otpCode: number,
    callingCode: string | undefined,
    purpose: OtpPurpose,
    recipientName: string,
  ) {
    try {
      const codePurpose =
        purpose === OtpPurpose.PASSWORD_RESET
          ? 'password reset'
          : 'sign-up verification';
      return await this.sendTermiiSms(
        mobile,
        `${this.greeting(recipientName)} your Cushy Access ${codePurpose} code is: ${otpCode}. Do not share this code with anyone.`,
        callingCode,
      );
    } catch (error) {
      this.logSmsFailure('OTP', error);
      return null;
    }
  }

  async sendOrderSmsNotif(
    mobile: string,
    user_phone: string,
    delivery_address: string | null | undefined,
    amount: number,
    merchantName: string,
    merchantCallingCode?: string,
    customerCallingCode?: string,
  ) {
    try {
      return await this.sendTermiiSms(
        mobile,
        `${this.greeting(merchantName)} you just received an order from ${this.formatPhoneForMessage(user_phone, customerCallingCode)} to be delivered to ${this.formatDeliveryAddress(delivery_address)} for NGN ${amount}. Powered by Cushy Access.`,
        merchantCallingCode,
      );
    } catch (error) {
      this.logSmsFailure('Order notification', error);
      return null;
    }
  }

  async sendRiderAssignmentSms(mobile: string, data: RiderAssignmentSmsData) {
    try {
      const normalizedCustomerName =
        (data.customerName || '')
          .replace(/[\r\n\t]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim() || 'Customer';
      const customerName =
        normalizedCustomerName.length > 100
          ? `${normalizedCustomerName.slice(0, 97)}...`
          : normalizedCustomerName;
      const normalizedRiderNote = (data.riderNote || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const riderNote =
        normalizedRiderNote.length > 500
          ? `${normalizedRiderNote.slice(0, 497)}...`
          : normalizedRiderNote;
      let customerPhone = 'Not provided';
      if (data.customerPhone?.trim()) {
        try {
          customerPhone = this.formatPhoneForMessage(
            data.customerPhone,
            data.customerCallingCode,
          );
        } catch {
          customerPhone = data.customerPhone.trim();
        }
      }
      const pickupName =
        (data.pickupName || '')
          .replace(/[\r\n\t]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim() || 'the pickup point';
      const pickupLocation = this.formatDeliveryAddress(data.pickupLocation);
      const pickupTypeLabel =
        (data.pickupTypeLabel || 'Pickup point')
          .replace(/[^a-z\s-]/gi, '')
          .replace(/\s+/g, ' ')
          .trim() || 'Pickup point';
      let pickupPhone = 'Not provided';
      if (data.pickupPhone?.trim()) {
        try {
          pickupPhone = this.formatPhoneForMessage(
            data.pickupPhone,
            data.pickupCallingCode,
          );
        } catch {
          pickupPhone = data.pickupPhone.trim();
        }
      }

      const noteSentence = riderNote ? `Message to Rider: ${riderNote}. ` : '';
      const message =
        `${this.greeting(data.riderName)} delivery from ${pickupName} in ${pickupLocation} has been assigned to you. ` +
        `${pickupTypeLabel} phone number: ${pickupPhone}. ` +
        `Customer: ${customerName}. Phone: ${customerPhone}. ` +
        `Delivery: ${this.formatDeliveryAddress(data.deliveryAddress)}. ` +
        noteSentence +
        'Open the Cushy Rider app for navigation and live updates.';

      return await this.sendTermiiSms(mobile, message, data.riderCallingCode);
    } catch (error) {
      this.logSmsFailure('Rider assignment', error);
      return null;
    }
  }

  async sendConsultationRequestSms(
    doctorMobile: string,
    data: ConsultationRequestSmsData,
  ) {
    try {
      const symptoms = (data.symptoms || 'Not provided').trim();
      const truncatedSymptoms =
        symptoms.length > 100 ? `${symptoms.slice(0, 100)}...` : symptoms;
      const doctorName = this.formatDoctorName(data.doctorName);
      const patientName = this.formatRecipientName(data.patientName);

      const sms =
        `${this.greeting(doctorName)} you have a new consultation request from ${patientName}. ` +
        `Symptoms: ${truncatedSymptoms}. ` +
        `Please open the Cushy Access app to accept or decline. Appointment ID: ${data.appointmentId}.`;

      return await this.sendTermiiSms(
        doctorMobile,
        sms,
        data.doctorCallingCode,
      );
    } catch (error) {
      this.logSmsFailure('Consultation request', error);
      return null;
    }
  }

  async sendAppointmentSmsNotif(
    patientMobile: string,
    doctorMobile: string,
    appointmentData: AppointmentSmsData,
  ) {
    const formattedFee = appointmentData.consultationFee
      ? `NGN ${appointmentData.consultationFee}`
      : 'FREE';
    const formattedTime = this.formatTimeWithAmPm(
      appointmentData.appointmentTime,
    );
    const patientName = this.formatRecipientName(appointmentData.patientName);
    const doctorName = this.formatDoctorName(appointmentData.doctorName);
    const appointmentDay = this.formatDayLabel(appointmentData.appointmentDay);
    const appointmentDate = this.formatAppointmentDate(
      appointmentData.appointmentDate,
    );

    const patientSms = `${this.greeting(patientName)} your appointment with ${doctorName} has been confirmed for ${appointmentDay}, ${appointmentDate} at ${formattedTime}. Consultation Fee: ${formattedFee}. Powered by Cushy Access.`;
    const doctorSms = `${this.greeting(doctorName)} you have a new appointment with ${patientName} on ${appointmentDate} at ${formattedTime}. Powered by Cushy Access.`;

    const [patientResult, doctorResult] = await Promise.allSettled([
      this.sendTermiiSms(
        patientMobile,
        patientSms,
        appointmentData.patientCallingCode,
      ),
      this.sendTermiiSms(
        doctorMobile,
        doctorSms,
        appointmentData.doctorCallingCode,
      ),
    ]);

    const fallbackDeliveries: Promise<unknown>[] = [];
    if (patientResult.status === 'rejected') {
      this.logSmsFailure('Patient appointment', patientResult.reason);
      if (this.canSafelyTryFallback(patientResult.reason)) {
        fallbackDeliveries.push(
          this.sendFallbackAppointmentSms(
            'patient',
            patientMobile,
            appointmentData,
          ),
        );
      }
    }
    if (doctorResult.status === 'rejected') {
      this.logSmsFailure('Doctor appointment', doctorResult.reason);
      if (this.canSafelyTryFallback(doctorResult.reason)) {
        fallbackDeliveries.push(
          this.sendFallbackAppointmentSms(
            'doctor',
            doctorMobile,
            appointmentData,
          ),
        );
      }
    }
    await Promise.all(fallbackDeliveries);

    return {
      patientResponse:
        patientResult.status === 'fulfilled' ? patientResult.value : null,
      doctorResponse:
        doctorResult.status === 'fulfilled' ? doctorResult.value : null,
    };
  }

  private formatTimeWithAmPm(timeString: string): string {
    const normalized = (timeString || '').trim();
    if (/^\d{1,2}:\d{2}\s*(?:AM|PM)$/i.test(normalized)) {
      return normalized.replace(/\s*(am|pm)$/i, ' $1').toUpperCase();
    }
    const match = normalized.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return normalized || 'the scheduled time';

    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return normalized;

    const amPm = hours >= 12 ? 'PM' : 'AM';

    hours = hours % 12;
    hours = hours ? hours : 12;

    return `${hours}:${String(minutes).padStart(2, '0')} ${amPm}`;
  }

  private formatDayLabel(day: string): string {
    const normalized = (day || '').trim().toLowerCase();
    if (!normalized) throw new Error('Appointment day is required for SMS');
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  private formatAppointmentDate(
    dateString: string,
    includeWeekday = false,
  ): string {
    const normalized = (dateString || '').trim();
    if (!normalized) throw new Error('Appointment date is required for SMS');

    const isoDate = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = isoDate
      ? new Date(
          Date.UTC(
            Number(isoDate[1]),
            Number(isoDate[2]) - 1,
            Number(isoDate[3]),
            12,
          ),
        )
      : new Date(normalized);
    if (Number.isNaN(date.getTime())) return normalized;

    return date.toLocaleDateString('en-GB', {
      ...(includeWeekday ? { weekday: 'long' as const } : {}),
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Lagos',
    });
  }

  private async sendFallbackAppointmentSms(
    recipient: 'patient' | 'doctor',
    mobile: string,
    appointmentData: AppointmentSmsData,
  ) {
    try {
      const formattedFee = appointmentData.consultationFee
        ? `NGN ${appointmentData.consultationFee}`
        : 'FREE';
      const formattedTime = this.formatTimeWithAmPm(
        appointmentData.appointmentTime,
      );
      const appointmentDate = this.formatAppointmentDate(
        appointmentData.appointmentDate,
      );
      const patientName = this.formatRecipientName(appointmentData.patientName);
      const doctorName = this.formatDoctorName(appointmentData.doctorName);
      const sms =
        recipient === 'patient'
          ? `${this.greeting(patientName)} Appointment confirmed with ${doctorName} on ${appointmentDate} at ${formattedTime}. Fee: ${formattedFee}. Powered by Cushy Access.`
          : `${this.greeting(doctorName)} New appointment with ${patientName} on ${appointmentDate} at ${formattedTime}. Powered by Cushy Access.`;

      return await this.sendTermiiSms(
        mobile,
        sms,
        recipient === 'patient'
          ? appointmentData.patientCallingCode
          : appointmentData.doctorCallingCode,
      );
    } catch (fallbackError) {
      this.logSmsFailure(`Fallback ${recipient} appointment`, fallbackError);
      return null;
    }
  }

  async sendAppointmentReminder(
    patientMobile: string,
    appointmentData: AppointmentReminderSmsData,
  ) {
    try {
      const appointmentDate = this.formatAppointmentDate(
        appointmentData.appointmentDate,
        true,
      );
      const timing =
        appointmentData.reminderType === '1-hour'
          ? `in 1 hour (${appointmentDate})`
          : `tomorrow (${appointmentDate})`;
      const reminderSms = `${this.greeting(appointmentData.patientName)} Reminder: your appointment with ${this.formatDoctorName(appointmentData.doctorName)} is ${timing} at ${this.formatTimeWithAmPm(appointmentData.appointmentTime)}. Powered by Cushy Access.`;

      return await this.sendTermiiSms(
        patientMobile,
        reminderSms,
        appointmentData.patientCallingCode,
      );
    } catch (error) {
      this.logSmsFailure('Appointment reminder', error);
      return null;
    }
  }

  async sendWelcomeSms(
    mobile: string,
    firstName: string,
    temporaryPassword: string,
    callingCode?: string,
  ) {
    try {
      const welcomeSms = `${this.greeting(firstName)} Welcome to Cushy Access. Your account has been created successfully. Your temporary password is: ${temporaryPassword}. Please log in and change your password immediately.`;

      return await this.sendTermiiSms(mobile, welcomeSms, callingCode);
    } catch (error) {
      this.logSmsFailure('Welcome', error);
      return null;
    }
  }
}

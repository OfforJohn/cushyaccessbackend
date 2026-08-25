// appointment-reminder.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventBus } from '@nestjs/cqrs';
import { PushNotificationEvent } from 'src/users/events/push-notification.event';
import { NotificationCategory } from 'src/users/model/notification-category';
import { MobileSenderService } from 'src/user-otp/mobile-sender.service';
import { Users } from 'src/users/model/users.entity';
import { Appointment } from './models/appointment.entity';
import { ConsultationStatus } from './models/enums/consultation-status.enum';
import { DayOfWeek } from './models/enums/day-of-week.enum';
import { MailSenderService } from 'src/user-otp/mail-sender.service';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const CONSULTATION_TIMEZONE = 'Africa/Lagos';

@Injectable()
export class AppointmentReminderService {
  private readonly logger = new Logger(AppointmentReminderService.name);

  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepo: Repository<Appointment>,
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,
    private readonly eventBus: EventBus,
    private readonly mobileSenderService: MobileSenderService,
    private readonly mailSenderService: MailSenderService,
  ) {}

  /**
   * Schedule reminders for a new appointment
   */
  async scheduleReminders(
    appointmentId: string,
    patientId: string,
    doctorId: string,
  ): Promise<void> {
    try {
      // Load appointment with relations
      const appointment = await this.appointmentRepo.findOne({
        where: { id: appointmentId },
        relations: ['patient', 'doctor'],
      });

      if (!appointment) {
        this.logger.warn(
          `Appointment ${appointmentId} not found for reminder scheduling`,
        );
        return;
      }

      // Ensure we have patient and doctor entities
      if (!appointment.patient) {
        appointment.patient = await this.usersRepo.findOne({
          where: { id: patientId },
        });
      }
      if (!appointment.doctor) {
        appointment.doctor = await this.usersRepo.findOne({
          where: { id: doctorId },
        });
      }

      this.logger.log(`Scheduled reminders for appointment ${appointmentId}`);
    } catch (error) {
      this.logger.error(
        `Failed to schedule reminders for appointment ${appointmentId}:`,
        error,
      );
    }
  }

  /**
   * Run every minute so appointment start reminders are close to real time.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleAppointmentReminders() {
    this.logger.debug('Checking for appointment reminders...');

    try {
      const upcomingAppointments = await this.getUpcomingAppointments();

      for (const appointment of upcomingAppointments) {
        await this.checkAndSendReminders(appointment);
      }
    } catch (error) {
      this.logger.error('Error handling appointment reminders:', error);
    }
  }

  /**
   * Get appointments happening in the next 24 hours
   */
  private async getUpcomingAppointments(): Promise<Appointment[]> {
    const today = dayjs().tz(CONSULTATION_TIMEZONE);
    const dayOfWeek = this.getDayOfWeekString(today.day());
    const tomorrow = today.add(1, 'day');
    const tomorrowDayOfWeek = this.getDayOfWeekString(tomorrow.day());

    // Format date for comparison (YYYY-MM-DD format)
    const todayDateStr = today.format('YYYY-MM-DD');
    const tomorrowDateStr = tomorrow.format('YYYY-MM-DD');

    // Since your appointment.day uses DayOfWeek enum (like 'MONDAY', 'TUESDAY')
    // and appointments are recurring weekly, we need to check both today and tomorrow
    return await this.appointmentRepo
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.patient', 'patient')
      .leftJoinAndSelect('appointment.doctor', 'doctor')
      .where('appointment.status IN (:...statuses)', {
        statuses: [ConsultationStatus.BOOKED, ConsultationStatus.ACKNOWLEDGED],
      })
      .andWhere(
        '(appointment.reminder24hSent = false OR appointment.reminder1hSent = false OR appointment.reminder15mSent = false OR appointment.reminderStartSent = false)',
      )
      .andWhere(
        `(
          (appointment.date IS NOT NULL AND appointment.date IN (:...targetDates))
          OR
          (appointment.date IS NULL AND appointment.day IN (:...targetDays))
        )`,
        {
          targetDates: [todayDateStr, tomorrowDateStr],
          targetDays: [dayOfWeek, tomorrowDayOfWeek],
        },
      )
      .getMany();
  }

  /**
   * Convert numeric day to DayOfWeek string
   */
  private getDayOfWeekString(dayNumber: number): DayOfWeek {
    const days = [
      DayOfWeek.SUNDAY,
      DayOfWeek.MONDAY,
      DayOfWeek.TUESDAY,
      DayOfWeek.WEDNESDAY,
      DayOfWeek.THURSDAY,
      DayOfWeek.FRIDAY,
      DayOfWeek.SATURDAY,
    ];
    return days[dayNumber];
  }

  /**
   * Check and send appropriate reminders
   */
  private async checkAndSendReminders(appointment: Appointment): Promise<void> {
    const now = dayjs().tz(CONSULTATION_TIMEZONE);
    const appointmentTime = this.calculateAppointmentDateTime(appointment, now);

    if (!appointmentTime) {
      this.logger.warn(
        `Could not calculate appointment time for ${appointment.id}`,
      );
      return;
    }

    const timeDifference = appointmentTime.valueOf() - now.valueOf();
    const hoursDifference = timeDifference / (1000 * 60 * 60);
    const minutesDifference = timeDifference / (1000 * 60);
    const isDayBeforeAppointment =
      appointmentTime.format('YYYY-MM-DD') ===
      now.add(1, 'day').format('YYYY-MM-DD');

    // Check and send 24-hour reminder
    if (
      !appointment.reminder24hSent &&
      ((hoursDifference <= 24 && hoursDifference > 23.5) ||
        (isDayBeforeAppointment && minutesDifference > 0))
    ) {
      await this.sendReminder(appointment, '24-hour');
      appointment.reminder24hSent = true;
      appointment.lastReminderSentAt = new Date();
      await this.appointmentRepo.save(appointment);
    }

    // Check and send 1-hour reminder
    if (
      hoursDifference <= 1 &&
      hoursDifference > 0.5 &&
      !appointment.reminder1hSent
    ) {
      await this.sendReminder(appointment, '1-hour');
      appointment.reminder1hSent = true;
      appointment.lastReminderSentAt = new Date();
      await this.appointmentRepo.save(appointment);
    }

    // Check and send 15-minute reminder
    if (
      minutesDifference <= 15 &&
      minutesDifference > 10 &&
      !appointment.reminder15mSent
    ) {
      await this.sendReminder(appointment, '15-minute');
      appointment.reminder15mSent = true;
      appointment.lastReminderSentAt = new Date();
      await this.appointmentRepo.save(appointment);
    }

    if (
      minutesDifference <= 0 &&
      minutesDifference > -5 &&
      !appointment.reminderStartSent
    ) {
      await this.sendReminder(appointment, 'start');
      appointment.reminderStartSent = true;
      appointment.lastReminderSentAt = new Date();
      await this.appointmentRepo.save(appointment);
    }
  }

  /**
   * Calculate the exact date and time of the appointment
   * Since appointments are weekly, we need to find the next occurrence
   */
  private normalizeTimeForDate(time: string): string {
    const [hours = '0', minutes = '0', seconds = '0'] = String(
      time || '',
    ).split(':');
    return [
      hours.padStart(2, '0'),
      minutes.padStart(2, '0'),
      seconds.padStart(2, '0'),
    ].join(':');
  }

  private calculateAppointmentDateTime(
    appointment: Appointment,
    referenceDate: Dayjs,
  ): Dayjs | null {
    try {
      const [hours, minutes] = appointment.startTime.split(':').map(Number);

      if (appointment.date) {
        const appointmentDate = dayjs.tz(
          `${appointment.date}T${this.normalizeTimeForDate(appointment.startTime)}`,
          CONSULTATION_TIMEZONE,
        );
        if (!appointmentDate.isValid()) return null;

        return appointmentDate;
      }

      // Convert DayOfWeek to numeric (0 = Sunday, 1 = Monday, etc.)
      const dayMap = {
        [DayOfWeek.SUNDAY]: 0,
        [DayOfWeek.MONDAY]: 1,
        [DayOfWeek.TUESDAY]: 2,
        [DayOfWeek.WEDNESDAY]: 3,
        [DayOfWeek.THURSDAY]: 4,
        [DayOfWeek.FRIDAY]: 5,
        [DayOfWeek.SATURDAY]: 6,
      };

      const targetDay = dayMap[appointment.day];
      if (targetDay === undefined) return null;

      const currentDay = referenceDate.day();

      // Calculate days to add to reach the target day
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd < 0) {
        daysToAdd += 7; // Move to next week
      }

      // If it's today but the time has passed, move to next week
      if (daysToAdd === 0) {
        const currentHour = referenceDate.hour();
        const currentMinute = referenceDate.minute();
        if (
          currentHour > hours ||
          (currentHour === hours && currentMinute >= minutes)
        ) {
          daysToAdd = 7;
        }
      }

      return referenceDate
        .add(daysToAdd, 'day')
        .hour(hours)
        .minute(minutes)
        .second(0)
        .millisecond(0);
    } catch (error) {
      this.logger.error(
        `Error calculating appointment time for ${appointment.id}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Send reminder notification
   */
  private async sendReminder(
    appointment: Appointment,
    reminderType: '24-hour' | '1-hour' | '15-minute' | 'start',
  ): Promise<void> {
    try {
      if (!appointment.patient || !appointment.doctor) {
        this.logger.warn(
          `Missing patient or doctor for appointment ${appointment.id}`,
        );
        return;
      }

      const { patientMessage, doctorMessage } = this.getReminderMessage(
        reminderType,
        appointment,
      );

      // Send push notification to patient
      this.eventBus.publish(
        new PushNotificationEvent(
          appointment.patient.id,
          NotificationCategory.APPOINTMENT_REMINDER,
          JSON.stringify({
            body: patientMessage,
            appointmentId: appointment.id,
            appointmentDate: this.formatAppointmentDate(appointment),
            appointmentTime: appointment.startTime,
            meetingLink:
              appointment.patientMeetingLink || appointment.meetingLink,
            reminderType,
          }),
        ),
      );

      // Send push notification to doctor
      this.eventBus.publish(
        new PushNotificationEvent(
          appointment.doctor.id,
          NotificationCategory.DOCTOR_APPOINTMENT_REMINDER,
          JSON.stringify({
            body: doctorMessage,
            appointmentId: appointment.id,
            appointmentDate: this.formatAppointmentDate(appointment),
            appointmentTime: appointment.startTime,
            meetingLink:
              appointment.doctorMeetingLink || appointment.meetingLink,
            reminderType,
          }),
        ),
      );

      // Send SMS for 24-hour and 1-hour reminders
      if (
        (reminderType === '24-hour' || reminderType === '1-hour') &&
        appointment.patient.mobile
      ) {
        await this.mobileSenderService.sendAppointmentReminder(
          appointment.patient.mobile,
          {
            patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
            patientCallingCode: appointment.patient.callingCode,
            doctorName: `Dr. ${appointment.doctor.firstName} ${appointment.doctor.lastName}`,
            appointmentDate: this.formatAppointmentDate(appointment),
            appointmentTime: appointment.startTime,
            reminderType,
          },
        );
      }

      await this.sendReminderEmails(appointment, reminderType);

      this.logger.log(
        `Sent ${reminderType} reminder for appointment ${appointment.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send ${reminderType} reminder for appointment ${appointment.id}:`,
        error,
      );
    }
  }

  private async sendReminderEmails(
    appointment: Appointment,
    reminderType: '24-hour' | '1-hour' | '15-minute' | 'start',
  ) {
    if (reminderType !== '24-hour') return;

    const appointmentDate = this.formatAppointmentDate(appointment);
    const doctorName =
      `Dr. ${appointment.doctor.firstName} ${appointment.doctor.lastName}`.trim();
    const patientName =
      `${appointment.patient.firstName} ${appointment.patient.lastName}`.trim();
    const baseContent = {
      appointmentDate,
      appointmentTime: appointment.startTime,
      consultationType: appointment.consultationType,
      consultationFee: Number(appointment.consultationAmount || 0),
      duration: '30 minutes',
      currentYear: new Date().getFullYear(),
    };

    if (appointment.patient.email) {
      await this.mailSenderService
        .sendMail({
          recipient: appointment.patient.email,
          subject: 'Appointment Reminder - Cushy Access',
          template: 'appointment-reminder',
          content: {
            ...baseContent,
            recipientName: patientName,
            headline: 'Your consultation is tomorrow',
            intro: 'This is a reminder for your scheduled health consultation.',
            counterpartLabel: 'Doctor',
            counterpartName: doctorName,
            meetingLink:
              appointment.patientMeetingLink || appointment.meetingLink,
          },
        })
        .catch((error) => {
          this.logger.error(
            `Failed to send patient reminder email for appointment ${appointment.id}`,
            error,
          );
        });
    }

    if (appointment.doctor.email) {
      await this.mailSenderService
        .sendMail({
          recipient: appointment.doctor.email,
          subject: 'Appointment Reminder - Cushy Access',
          template: 'appointment-reminder',
          content: {
            ...baseContent,
            recipientName: doctorName,
            headline: 'You have a consultation tomorrow',
            intro:
              'This is a reminder for your scheduled patient consultation.',
            counterpartLabel: 'Patient',
            counterpartName: patientName,
            meetingLink:
              appointment.doctorMeetingLink || appointment.meetingLink,
          },
        })
        .catch((error) => {
          this.logger.error(
            `Failed to send doctor reminder email for appointment ${appointment.id}`,
            error,
          );
        });
    }
  }

  /**
   * Format appointment date for display
   */
  private formatAppointmentDate(appointment: Appointment): string {
    const today = dayjs().tz(CONSULTATION_TIMEZONE);
    const appointmentDate = this.calculateAppointmentDateTime(
      appointment,
      today,
    );

    if (!appointmentDate) return appointment.day; // Fallback to day name

    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };

    return appointmentDate.toDate().toLocaleDateString('en-US', {
      ...options,
      timeZone: CONSULTATION_TIMEZONE,
    });
  }

  /**
   * Get reminder messages based on type
   */
  private getReminderMessage(
    reminderType: '24-hour' | '1-hour' | '15-minute' | 'start',
    appointment: Appointment,
  ) {
    const timeLeft =
      reminderType === '24-hour'
        ? '24 hours'
        : reminderType === '1-hour'
          ? '1 hour'
          : reminderType === '15-minute'
            ? '15 minutes'
            : 'now';

    const formattedDate = this.formatAppointmentDate(appointment);

    if (reminderType === 'start') {
      return {
        patientMessage:
          'Your consultation starts now. Open your upcoming appointment to join.',
        doctorMessage:
          'Your scheduled consultation starts now. Open your Scheduled tab to join.',
      };
    }

    const patientMessage = `Appointment Reminder: Your consultation is in ${timeLeft} (${formattedDate} at ${appointment.startTime}). Join: ${appointment.meetingLink}`;

    const doctorMessage = `Appointment Reminder: You have a consultation in ${timeLeft} (${formattedDate} at ${appointment.startTime}). Meeting: ${appointment.meetingLink}`;

    return { patientMessage, doctorMessage };
  }

  /**
   * Cancel all reminders for an appointment (e.g., when appointment is cancelled)
   */
  async cancelReminders(appointmentId: string): Promise<void> {
    try {
      const appointment = await this.appointmentRepo.findOne({
        where: { id: appointmentId },
      });

      if (appointment) {
        // Mark all reminders as sent to prevent future reminders
        appointment.reminder24hSent = true;
        appointment.reminder1hSent = true;
        appointment.reminder15mSent = true;
        appointment.reminderStartSent = true;
        appointment.lastReminderSentAt = new Date();

        await this.appointmentRepo.save(appointment);
        this.logger.log(`Cancelled reminders for appointment ${appointmentId}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to cancel reminders for appointment ${appointmentId}:`,
        error,
      );
    }
  }
}

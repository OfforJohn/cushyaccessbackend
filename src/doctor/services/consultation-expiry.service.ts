import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { EventBus } from '@nestjs/cqrs';
import { Appointment } from '../models/appointment.entity';
import { ConsultationStatus } from '../models/enums/consultation-status.enum';
import { ConsultationGatewayService } from '../gateways/consultation-gateway.service';
import { PushNotificationEvent } from 'src/users/events/push-notification.event';
import { NotificationCategory } from 'src/users/model/notification-category';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

const PENDING_TIMEOUT_MS = 5 * 60 * 1000;
const HEALTH_TIMEZONE = 'Africa/Lagos';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class ConsultationExpiryService {
  private readonly logger = new Logger(ConsultationExpiryService.name);

  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepo: Repository<Appointment>,
    private readonly gatewayService: ConsultationGatewayService,
    private readonly eventBus: EventBus,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expirePendingConsultations() {
    await this.expireStalePendingConsultations();
    await this.expirePastScheduledAppointments();
  }

  private async expireStalePendingConsultations() {
    const cutoff = new Date(Date.now() - PENDING_TIMEOUT_MS);
    const staleAppointments = await this.appointmentRepo.find({
      where: {
        status: ConsultationStatus.PENDING_ACCEPTANCE,
        createdAt: LessThan(cutoff),
      },
    });

    if (!staleAppointments.length) return;

    staleAppointments.forEach((appointment) => {
      appointment.status = ConsultationStatus.EXPIRED;
      appointment.expiresAt =
        appointment.expiresAt ||
        new Date(
          new Date(appointment.createdAt).getTime() + PENDING_TIMEOUT_MS,
        );
    });

    const saved = await this.appointmentRepo.save(staleAppointments);

    saved.forEach((appointment) => {
      const payload = {
        appointmentId: appointment.id,
        status: ConsultationStatus.EXPIRED,
      };

      this.gatewayService.emitToPatient(
        appointment.patientId,
        'consultation_expired',
        payload,
      );
      this.gatewayService.emitToDoctor(
        appointment.doctorId,
        'consultation_expired',
        payload,
      );

      this.eventBus.publish(
        new PushNotificationEvent(
          appointment.patientId,
          NotificationCategory.CONSULTATION_EXPIRED,
          JSON.stringify({ ...payload, recipientRole: 'PATIENT' }),
        ),
      );
      this.eventBus.publish(
        new PushNotificationEvent(
          appointment.doctorId,
          NotificationCategory.CONSULTATION_EXPIRED,
          JSON.stringify({ ...payload, recipientRole: 'DOCTOR' }),
        ),
      );
    });

    this.logger.log(`Expired ${saved.length} pending consultation request(s)`);
  }

  private async expirePastScheduledAppointments() {
    const now = dayjs().tz(HEALTH_TIMEZONE);
    const expiredAt = now.toDate();
    const currentDate = now.format('YYYY-MM-DD');
    const currentTime = now.format('HH:mm:ss');

    const result = await this.appointmentRepo
      .createQueryBuilder()
      .update(Appointment)
      .set({
        status: ConsultationStatus.EXPIRED,
        expiresAt: expiredAt,
        reminder24hSent: true,
        reminder1hSent: true,
        reminder15mSent: true,
        reminderStartSent: true,
        lastReminderSentAt: expiredAt,
      })
      .where('status IN (:...statuses)', {
        statuses: [ConsultationStatus.BOOKED, ConsultationStatus.ACKNOWLEDGED],
      })
      .andWhere('"date" IS NOT NULL')
      .andWhere(
        '("date" < :currentDate OR ("date" = :currentDate AND "endTime" <= :currentTime))',
        {
          currentDate,
          currentTime,
        },
      )
      .returning(['id', 'patientId', 'doctorId'])
      .execute();

    const expiredAppointments = Array.isArray(result.raw) ? result.raw : [];
    if (!expiredAppointments.length) return;

    expiredAppointments.forEach((appointment) => {
      const appointmentId = appointment.id;
      const patientId =
        appointment.patientId ??
        appointment.patientid ??
        appointment.patient_id;
      const doctorId =
        appointment.doctorId ?? appointment.doctorid ?? appointment.doctor_id;
      const payload = {
        appointmentId,
        status: ConsultationStatus.EXPIRED,
        reason: 'Scheduled appointment window elapsed without a joined session',
      };

      if (patientId) {
        this.gatewayService.emitToPatient(
          patientId,
          'consultation_expired',
          payload,
        );
        this.eventBus.publish(
          new PushNotificationEvent(
            patientId,
            NotificationCategory.CONSULTATION_EXPIRED,
            JSON.stringify({ ...payload, recipientRole: 'PATIENT' }),
          ),
        );
      }

      if (doctorId) {
        this.gatewayService.emitToDoctor(
          doctorId,
          'consultation_expired',
          payload,
        );
        this.eventBus.publish(
          new PushNotificationEvent(
            doctorId,
            NotificationCategory.CONSULTATION_EXPIRED,
            JSON.stringify({ ...payload, recipientRole: 'DOCTOR' }),
          ),
        );
      }
    });

    this.logger.log(
      `Expired ${expiredAppointments.length} scheduled appointment(s)`,
    );
  }
}

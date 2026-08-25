import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { EventBus } from '@nestjs/cqrs';
import { Appointment } from '../models/appointment.entity';
import { ConsultationStatus } from '../models/enums/consultation-status.enum';
import { Users } from 'src/users/model/users.entity';
import { CommonService } from 'src/common/common.service';
import { StandardResponse } from 'src/common/module/standard-response';
import { PushNotificationEvent } from 'src/users/events/push-notification.event';
import { NotificationCategory } from 'src/users/model/notification-category';
import { ConsultationGatewayService } from '../gateways/consultation-gateway.service';
import { Wallets } from 'src/wallet/model/wallet.entity';
import { Transactions } from 'src/wallet/model/transaction.entity';
import { TransactionStatus } from 'src/wallet/model/transaction-status.enum';
import { TransactionCategory } from 'src/wallet/model/transaction-category.enum';
import { v4 as uuidv4 } from 'uuid';

export type DoctorConsultationAction = 'accept' | 'reject';

const PENDING_TIMEOUT_MS = 5 * 60 * 1000;

@Injectable()
export class DoctorViewConsultationRequestUseCase {
  constructor(
    private readonly commonService: CommonService,
    private readonly eventBus: EventBus,
    private readonly gatewayService: ConsultationGatewayService,
    private readonly dataSource: DataSource,
    @InjectRepository(Appointment)
    private readonly appointmentRepo: Repository<Appointment>,
    @InjectRepository(Users)
    private readonly userRepo: Repository<Users>,
  ) {}

  private getExpiresAt(appointment: Appointment): Date {
    return (
      appointment.expiresAt ||
      new Date(new Date(appointment.createdAt).getTime() + PENDING_TIMEOUT_MS)
    );
  }

  private secondsRemaining(appointment: Appointment): number {
    return Math.max(
      0,
      Math.ceil((this.getExpiresAt(appointment).getTime() - Date.now()) / 1000),
    );
  }

  private isExpired(appointment: Appointment): boolean {
    return this.secondsRemaining(appointment) <= 0;
  }

  private emitExpired(appointment: Appointment) {
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
  }

  async expireStalePendingForDoctor(doctorId: string) {
    const now = new Date();
    const cutoff = new Date(Date.now() - PENDING_TIMEOUT_MS);
    const staleRequests = await this.appointmentRepo.find({
      where: [
        {
          doctorId,
          status: ConsultationStatus.PENDING_ACCEPTANCE,
          expiresAt: LessThan(now),
        },
        {
          doctorId,
          status: ConsultationStatus.PENDING_ACCEPTANCE,
          createdAt: LessThan(cutoff),
        },
      ],
    });

    if (!staleRequests.length) return;

    for (const request of staleRequests) {
      request.status = ConsultationStatus.EXPIRED;
      request.expiresAt = this.getExpiresAt(request);
    }

    await this.appointmentRepo.save(staleRequests);

    staleRequests.forEach((request) => this.emitExpired(request));
  }

  async getConsultationRequest(appointmentId: string) {
    const loggedInDoctor = await this.commonService.getLoggedInUser();
    await this.expireStalePendingForDoctor(loggedInDoctor.id);

    const appointment = await this.appointmentRepo.findOne({
      where: { id: appointmentId, doctorId: loggedInDoctor.id },
    });

    if (!appointment) {
      throw new NotFoundException('Consultation request not found');
    }

    const patient = await this.userRepo.findOne({
      where: { id: appointment.patientId },
    });

    return new StandardResponse(false, 'CONSULTATION_REQUEST_FETCHED', {
      appointmentId: appointment.id,
      status: appointment.status,
      patientId: appointment.patientId,
      patientName:
        `${patient?.firstName || ''} ${patient?.lastName || ''}`.trim(),
      patientEmail: patient?.email,
      patientPhone: patient?.mobile,
      consultationFee: Number(appointment.consultationAmount || 0),
      meetingLink: appointment.doctorMeetingLink,
      roomId: appointment.roomName,
      requestedAt: appointment.createdAt,
      expiresAt: this.getExpiresAt(appointment),
      secondsRemaining: this.secondsRemaining(appointment),
      canRespond:
        appointment.status === ConsultationStatus.PENDING_ACCEPTANCE &&
        !this.isExpired(appointment),
    });
  }

  async getPendingRequests() {
    const loggedInDoctor = await this.commonService.getLoggedInUser();
    await this.expireStalePendingForDoctor(loggedInDoctor.id);

    const pending = await this.appointmentRepo.find({
      where: {
        doctorId: loggedInDoctor.id,
        status: ConsultationStatus.PENDING_ACCEPTANCE,
      },
      order: { createdAt: 'DESC' },
    });

    const enriched = await Promise.all(
      pending.map(async (appt) => {
        const patient = await this.userRepo.findOne({
          where: { id: appt.patientId },
        });
        return {
          appointmentId: appt.id,
          status: appt.status,
          consultationFee: Number(appt.consultationAmount || 0),
          meetingLink: appt.doctorMeetingLink,
          roomId: appt.roomName,
          requestedAt: appt.createdAt,
          expiresAt: this.getExpiresAt(appt),
          secondsRemaining: this.secondsRemaining(appt),
          patientId: appt.patientId,
          patientName:
            `${patient?.firstName || ''} ${patient?.lastName || ''}`.trim(),
          patientEmail: patient?.email,
          patientPhone: patient?.mobile,
        };
      }),
    );

    return new StandardResponse(false, 'PENDING_REQUESTS_FETCHED', {
      total: enriched.length,
      requests: enriched,
    });
  }

  async respondToRequest(
    appointmentId: string,
    action: DoctorConsultationAction,
  ) {
    const loggedInDoctor = await this.commonService.getLoggedInUser();
    return this.respondToRequestForDoctor(
      appointmentId,
      action,
      loggedInDoctor.id,
    );
  }

  async respondToRequestForDoctor(
    appointmentId: string,
    action: DoctorConsultationAction,
    doctorId: string,
  ) {
    if (action === 'accept') {
      return this.acceptRequest(appointmentId, doctorId);
    }

    if (action === 'reject') {
      return this.rejectRequest(appointmentId, doctorId);
    }

    throw new BadRequestException(
      new StandardResponse(true, 'INVALID_CONSULTATION_ACTION'),
    );
  }

  private async acceptRequest(appointmentId: string, doctorId: string) {
    const doctor = await this.userRepo.findOne({ where: { id: doctorId } });
    if (!doctor) {
      throw new NotFoundException(
        new StandardResponse(true, 'DOCTOR_NOT_FOUND'),
      );
    }

    const preflightAppointment = await this.appointmentRepo.findOne({
      where: { id: appointmentId, doctorId },
    });

    if (!preflightAppointment) {
      throw new NotFoundException(
        new StandardResponse(true, 'CONSULTATION_REQUEST_NOT_FOUND'),
      );
    }

    if (preflightAppointment.status !== ConsultationStatus.PENDING_ACCEPTANCE) {
      throw new BadRequestException(
        new StandardResponse(
          true,
          `CANNOT_ACCEPT_CONSULTATION_IN_STATUS_${preflightAppointment.status}`,
        ),
      );
    }

    if (this.isExpired(preflightAppointment)) {
      preflightAppointment.status = ConsultationStatus.EXPIRED;
      preflightAppointment.expiresAt = this.getExpiresAt(preflightAppointment);
      await this.appointmentRepo.save(preflightAppointment);
      this.emitExpired(preflightAppointment);
      throw new BadRequestException(
        new StandardResponse(true, 'CONSULTATION_REQUEST_EXPIRED'),
      );
    }

    let acceptedAppointment: Appointment;
    let cancelledSiblingAppointments: Appointment[] = [];
    let debitAmount = 0;
    let acceptanceBlockedReason: string | null = null;

    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `consultation_accept:${preflightAppointment.patientId}`,
      ]);

      const appointment = await manager.findOne(Appointment, {
        where: { id: appointmentId, doctorId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!appointment) {
        throw new NotFoundException(
          new StandardResponse(true, 'CONSULTATION_REQUEST_NOT_FOUND'),
        );
      }

      if (appointment.status !== ConsultationStatus.PENDING_ACCEPTANCE) {
        throw new BadRequestException(
          new StandardResponse(
            true,
            `CANNOT_ACCEPT_CONSULTATION_IN_STATUS_${appointment.status}`,
          ),
        );
      }

      if (this.isExpired(appointment)) {
        throw new BadRequestException(
          new StandardResponse(true, 'CONSULTATION_REQUEST_EXPIRED'),
        );
      }

      const existingActiveAppointment = await manager.findOne(Appointment, {
        where: {
          patientId: appointment.patientId,
          status: ConsultationStatus.ACTIVE,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        existingActiveAppointment &&
        existingActiveAppointment.id !== appointment.id
      ) {
        appointment.status = ConsultationStatus.CANCELLED;
        await manager.save(Appointment, appointment);
        acceptanceBlockedReason =
          'CONSULTATION_ALREADY_ACCEPTED_BY_ANOTHER_DOCTOR';
        return;
      }

      debitAmount = Number(appointment.consultationAmount || 0);

      if (debitAmount > 0) {
        const patientWallet = await manager.findOne(Wallets, {
          where: { userId: appointment.patientId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!patientWallet) {
          throw new NotFoundException(
            new StandardResponse(true, 'USER_WALLET_NOT_INITIALIZED'),
          );
        }

        if (Number(patientWallet.walletBalance) < debitAmount) {
          throw new ForbiddenException(
            new StandardResponse(true, 'INSUFFICIENT_FUNDS'),
          );
        }

        patientWallet.walletBalance = Number(
          (Number(patientWallet.walletBalance) - debitAmount).toFixed(2),
        );
        await manager.save(Wallets, patientWallet);

        const transaction = manager.create(Transactions, {
          userId: appointment.patientId,
          walletId: patientWallet.id,
          amount: debitAmount,
          transactionReference: `CONSULT-HOLD-${uuidv4()}`,
          description: 'CONSULTATION_ESCROW_HOLD',
          category: TransactionCategory.CONSULTATION_DEBIT,
          status: TransactionStatus.COMPLETED,
          orderId: appointment.id,
        });
        await manager.save(Transactions, transaction);
      }

      appointment.status = ConsultationStatus.ACTIVE;
      appointment.acceptedAt = new Date();
      acceptedAppointment = await manager.save(Appointment, appointment);

      cancelledSiblingAppointments = await manager.find(Appointment, {
        where: {
          patientId: appointment.patientId,
          status: ConsultationStatus.PENDING_ACCEPTANCE,
        },
      });

      if (cancelledSiblingAppointments.length) {
        await manager
          .createQueryBuilder()
          .update(Appointment)
          .set({ status: ConsultationStatus.CANCELLED })
          .where('"id" IN (:...ids)', {
            ids: cancelledSiblingAppointments.map((sibling) => sibling.id),
          })
          .execute();
      }
    });

    if (acceptanceBlockedReason) {
      throw new BadRequestException(
        new StandardResponse(true, acceptanceBlockedReason),
      );
    }

    const payload = {
      event: 'CONSULTATION_ACCEPTED',
      appointmentId: acceptedAppointment.id,
      status: acceptedAppointment.status,
      doctorId,
      doctorName: `Dr. ${doctor.firstName} ${doctor.lastName}`,
      meetingLink: acceptedAppointment.patientMeetingLink,
      patientMeetingLink: acceptedAppointment.patientMeetingLink,
      doctorMeetingLink: acceptedAppointment.doctorMeetingLink,
      roomId: acceptedAppointment.roomName,
      consultationFee: debitAmount,
      acceptedAt: acceptedAppointment.acceptedAt,
    };

    this.eventBus.publish(
      new PushNotificationEvent(
        acceptedAppointment.patientId,
        NotificationCategory.CONSULTATION_STARTED,
        JSON.stringify(payload),
      ),
    );

    this.gatewayService.emitToPatient(
      acceptedAppointment.patientId,
      'consultation_accepted',
      payload,
    );
    this.gatewayService.emitToPatient(
      acceptedAppointment.patientId,
      'consultation_response',
      payload,
    );
    this.gatewayService.emitToDoctor(doctorId, 'consultation_accepted', {
      ...payload,
      meetingLink: acceptedAppointment.doctorMeetingLink,
    });

    cancelledSiblingAppointments.forEach((appointment) => {
      const cancellationPayload = {
        appointmentId: appointment.id,
        status: ConsultationStatus.CANCELLED,
        patientId: appointment.patientId,
        cancelledBy: 'SYSTEM',
        reason: 'Another doctor accepted this consultation request.',
      };

      this.gatewayService.emitToDoctor(
        appointment.doctorId,
        'consultation_cancelled',
        cancellationPayload,
      );
      this.eventBus.publish(
        new PushNotificationEvent(
          appointment.doctorId,
          NotificationCategory.CONSULTATION_CANCELLED,
          JSON.stringify(cancellationPayload),
        ),
      );
    });

    return new StandardResponse(false, 'CONSULTATION_ACCEPTED', {
      ...payload,
      meetingLink: acceptedAppointment.doctorMeetingLink,
    });
  }

  private async rejectRequest(appointmentId: string, doctorId: string) {
    const appointment = await this.appointmentRepo.findOne({
      where: { id: appointmentId, doctorId },
    });

    if (!appointment) {
      throw new NotFoundException(
        new StandardResponse(true, 'CONSULTATION_REQUEST_NOT_FOUND'),
      );
    }

    if (appointment.status !== ConsultationStatus.PENDING_ACCEPTANCE) {
      throw new BadRequestException(
        new StandardResponse(
          true,
          `CANNOT_REJECT_CONSULTATION_IN_STATUS_${appointment.status}`,
        ),
      );
    }

    if (this.isExpired(appointment)) {
      appointment.status = ConsultationStatus.EXPIRED;
      appointment.expiresAt = this.getExpiresAt(appointment);
      await this.appointmentRepo.save(appointment);
      this.emitExpired(appointment);
      throw new BadRequestException(
        new StandardResponse(true, 'CONSULTATION_REQUEST_EXPIRED'),
      );
    }

    appointment.status = ConsultationStatus.REJECTED;
    await this.appointmentRepo.save(appointment);

    const payload = {
      event: 'CONSULTATION_REJECTED',
      appointmentId: appointment.id,
      status: appointment.status,
      doctorId,
    };

    this.eventBus.publish(
      new PushNotificationEvent(
        appointment.patientId,
        NotificationCategory.CONSULTATION_REJECTED,
        JSON.stringify(payload),
      ),
    );

    this.gatewayService.emitToPatient(
      appointment.patientId,
      'consultation_rejected',
      payload,
    );
    this.gatewayService.emitToPatient(
      appointment.patientId,
      'consultation_response',
      payload,
    );
    this.gatewayService.emitToDoctor(
      doctorId,
      'consultation_rejected',
      payload,
    );

    return new StandardResponse(false, 'CONSULTATION_REJECTED', payload);
  }
}

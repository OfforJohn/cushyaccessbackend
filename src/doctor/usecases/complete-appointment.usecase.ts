import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Appointment } from '../models/appointment.entity';
import { CommonService } from 'src/common/common.service';
import { ConsultationStatus } from '../models/enums/consultation-status.enum';
import { StandardResponse } from 'src/common/module/standard-response';
import { EventBus } from '@nestjs/cqrs';
import { PushNotificationEvent } from 'src/users/events/push-notification.event';
import { NotificationCategory } from 'src/users/model/notification-category';
import { TransactionRequest } from 'src/wallet/model/dto/transaction.request';
import { TransactionStatus } from 'src/wallet/model/transaction-status.enum';
import { TransactionCategory } from 'src/wallet/model/transaction-category.enum';
import { TransactionService } from 'src/wallet/services/transaction.service';
import { Wallets } from 'src/wallet/model/wallet.entity';
import { ConsultationGatewayService } from '../gateways/consultation-gateway.service';
import { v4 as uuidv4 } from 'uuid';
import { Transactions } from 'src/wallet/model/transaction.entity';

@Injectable()
export class CompleteAppointmentUsecase {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepo: Repository<Appointment>,
    private readonly commonService: CommonService,
    private readonly eventBus: EventBus,
    private readonly transactionService: TransactionService,
    private readonly dataSource: DataSource,
    private readonly gatewayService: ConsultationGatewayService,
  ) {}

  private getDurationSeconds(appointment: Appointment): number {
    const start = appointment.acceptedAt || appointment.createdAt;
    const end = appointment.completedAt || new Date();
    if (!start || !end) return 0;
    return Math.max(
      0,
      Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000),
    );
  }

  private getScheduledDate(date?: string, time?: string): Date | null {
    if (!date || !time) return null;

    const [timePart] = String(time).split('.');
    const normalizedTime = timePart.length === 5 ? `${timePart}:00` : timePart;
    const scheduledDate = new Date(`${date}T${normalizedTime}+01:00`);

    return Number.isNaN(scheduledDate.getTime()) ? null : scheduledDate;
  }

  private isWithinScheduledWindow(appointment: Appointment): boolean {
    const start = this.getScheduledDate(
      appointment.date,
      appointment.startTime,
    );
    const end = this.getScheduledDate(appointment.date, appointment.endTime);

    if (!start || !end) return false;

    const now = new Date();
    return now >= start && now <= end;
  }

  private async ensureConsultationHold(
    manager: any,
    appointment: Appointment,
  ): Promise<number> {
    const consultationAmount = Number(appointment.consultationAmount || 0);
    if (consultationAmount <= 0) return 0;

    const existingHold = await manager.findOne(Transactions, {
      where: {
        orderId: appointment.id,
        userId: appointment.patientId,
        category: TransactionCategory.CONSULTATION_DEBIT,
        status: TransactionStatus.COMPLETED,
      },
    });

    if (existingHold) {
      if (Number(existingHold.amount || 0) < consultationAmount) {
        throw new BadRequestException(
          new StandardResponse(true, 'CONSULTATION_ESCROW_HOLD_INVALID'),
        );
      }

      return 0;
    }

    const patientWallet = await manager.findOne(Wallets, {
      where: { userId: appointment.patientId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!patientWallet) {
      throw new NotFoundException(
        new StandardResponse(true, 'USER_WALLET_NOT_INITIALIZED'),
      );
    }

    if (Number(patientWallet.walletBalance) < consultationAmount) {
      throw new ForbiddenException(
        new StandardResponse(true, 'INSUFFICIENT_FUNDS'),
      );
    }

    patientWallet.walletBalance = Number(
      (Number(patientWallet.walletBalance) - consultationAmount).toFixed(2),
    );
    await manager.save(Wallets, patientWallet);

    const holdTransaction = manager.create(Transactions, {
      userId: appointment.patientId,
      walletId: patientWallet.id,
      amount: consultationAmount,
      transactionReference: `CONSULT-HOLD-${uuidv4()}`,
      description: 'CONSULTATION_ESCROW_HOLD',
      category: TransactionCategory.CONSULTATION_DEBIT,
      status: TransactionStatus.COMPLETED,
      orderId: appointment.id,
    });
    await manager.save(Transactions, holdTransaction);

    return consultationAmount;
  }

  async start(appointmentId: string) {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    let startedAppointment: Appointment;
    let heldAmount = 0;

    await this.dataSource.transaction(async (manager) => {
      const appointment = await manager.findOne(Appointment, {
        where: { id: appointmentId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!appointment) {
        throw new NotFoundException(
          new StandardResponse(true, 'APPOINTMENT_NOT_FOUND'),
        );
      }

      const isParticipant =
        appointment.doctorId === authenticatedUser.id ||
        appointment.patientId === authenticatedUser.id;

      if (!isParticipant) {
        throw new ForbiddenException(
          new StandardResponse(true, 'UNAUTHORIZED_CONSULTATION_ACCESS'),
        );
      }

      if (appointment.status === ConsultationStatus.ACTIVE) {
        startedAppointment = appointment;
        return;
      }

      if (appointment.status !== ConsultationStatus.ACKNOWLEDGED) {
        throw new BadRequestException(
          new StandardResponse(
            true,
            `CANNOT_START_APPOINTMENT_IN_STATUS_${appointment.status}`,
          ),
        );
      }

      if (!this.isWithinScheduledWindow(appointment)) {
        throw new BadRequestException(
          new StandardResponse(true, 'APPOINTMENT_NOT_IN_JOIN_WINDOW'),
        );
      }

      heldAmount = await this.ensureConsultationHold(manager, appointment);
      appointment.status = ConsultationStatus.ACTIVE;
      appointment.acceptedAt = new Date();
      startedAppointment = await manager.save(Appointment, appointment);
    });

    const payload = {
      appointmentId: startedAppointment.id,
      status: startedAppointment.status,
      doctorMeetingLink: startedAppointment.doctorMeetingLink,
      patientMeetingLink: startedAppointment.patientMeetingLink,
      meetingLink:
        authenticatedUser.id === startedAppointment.doctorId
          ? startedAppointment.doctorMeetingLink
          : startedAppointment.patientMeetingLink,
      roomId: startedAppointment.roomName,
      heldAmount,
      acceptedAt: startedAppointment.acceptedAt,
    };

    this.gatewayService.emitToPatient(
      startedAppointment.patientId,
      'consultation_started',
      payload,
    );
    this.gatewayService.emitToDoctor(
      startedAppointment.doctorId,
      'consultation_started',
      payload,
    );

    return new StandardResponse(
      false,
      'APPOINTMENT_STARTED_SUCCESSFULLY',
      payload,
    );
  }

  async execute(appointmentId: string) {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    let completedAppointment: Appointment;
    let paidDoctorAmount = 0;
    let completedNow = false;
    let settlementStatus: 'NO_FEE' | 'ESCROW_RELEASED' | 'ESCROW_HOLD_MISSING' =
      'NO_FEE';

    await this.dataSource.transaction(async (manager) => {
      const appointment = await manager.findOne(Appointment, {
        where: { id: appointmentId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!appointment) {
        throw new NotFoundException(
          new StandardResponse(true, 'APPOINTMENT_NOT_FOUND'),
        );
      }

      const isParticipant =
        appointment.doctorId === authenticatedUser.id ||
        appointment.patientId === authenticatedUser.id;

      if (!isParticipant) {
        throw new ForbiddenException(
          new StandardResponse(true, 'UNAUTHORIZED_CONSULTATION_ACCESS'),
        );
      }

      if (appointment.status === ConsultationStatus.COMPLETED) {
        completedAppointment = appointment;
        return;
      }

      if (appointment.status === ConsultationStatus.ACKNOWLEDGED) {
        if (!this.isWithinScheduledWindow(appointment)) {
          throw new BadRequestException(
            new StandardResponse(true, 'APPOINTMENT_NOT_IN_JOIN_WINDOW'),
          );
        }

        await this.ensureConsultationHold(manager, appointment);
        appointment.status = ConsultationStatus.ACTIVE;
        appointment.acceptedAt = appointment.acceptedAt || new Date();
      }

      if (appointment.status !== ConsultationStatus.ACTIVE) {
        throw new BadRequestException(
          new StandardResponse(
            true,
            `CANNOT_COMPLETE_APPOINTMENT_IN_STATUS_${appointment.status}`,
          ),
        );
      }

      appointment.status = ConsultationStatus.COMPLETED;
      appointment.completedAt = new Date();
      if (!appointment.acceptedAt) {
        appointment.acceptedAt = appointment.createdAt;
      }

      const consultationAmount = Number(appointment.consultationAmount || 0);

      if (!appointment.isPaidOut && consultationAmount > 0) {
        const escrowHold = await manager.findOne(Transactions, {
          where: {
            orderId: appointment.id,
            userId: appointment.patientId,
            category: TransactionCategory.CONSULTATION_DEBIT,
            status: TransactionStatus.COMPLETED,
          },
        });

        if (
          !escrowHold ||
          Number(escrowHold.amount || 0) < consultationAmount
        ) {
          settlementStatus = 'ESCROW_HOLD_MISSING';
          completedAppointment = await manager.save(Appointment, appointment);
          completedNow = true;
          return;
        }

        const doctorWallet = await manager.findOne(Wallets, {
          where: { userId: appointment.doctorId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!doctorWallet) {
          throw new NotFoundException(
            new StandardResponse(true, 'DOCTOR_WALLET_NOT_INITIALIZED'),
          );
        }

        const platformFee = Number((consultationAmount * 0.2).toFixed(2));
        paidDoctorAmount = Number(
          (consultationAmount - platformFee).toFixed(2),
        );
        doctorWallet.walletBalance = Number(
          (Number(doctorWallet.walletBalance) + paidDoctorAmount).toFixed(2),
        );
        await manager.save(Wallets, doctorWallet);

        const doctorTransaction = new TransactionRequest();
        doctorTransaction.userId = appointment.doctorId;
        doctorTransaction.walletId = doctorWallet.id;
        doctorTransaction.amount = paidDoctorAmount;
        doctorTransaction.transactionReference = `CONSULT-RELEASE-${uuidv4()}`;
        doctorTransaction.description = 'CONSULTATION_ESCROW_RELEASE';
        doctorTransaction.orderId = appointmentId;
        doctorTransaction.category = TransactionCategory.CONSULTATION_REWARD;
        doctorTransaction.status = TransactionStatus.COMPLETED;
        await this.transactionService.createTransaction(
          doctorTransaction,
          manager,
        );
        settlementStatus = 'ESCROW_RELEASED';
      }

      appointment.isPaidOut = settlementStatus !== 'ESCROW_HOLD_MISSING';
      completedAppointment = await manager.save(Appointment, appointment);
      completedNow = true;
    });

    const payload = {
      appointmentId: completedAppointment.id,
      status: completedAppointment.status,
      completedAt: completedAppointment.completedAt,
      durationSeconds: this.getDurationSeconds(completedAppointment),
      paidDoctorAmount,
      settlementStatus,
    };

    if (completedNow) {
      this.eventBus.publish(
        new PushNotificationEvent(
          completedAppointment.patientId,
          NotificationCategory.CONSULTATION_COMPLETED,
          JSON.stringify(payload),
        ),
      );
      this.eventBus.publish(
        new PushNotificationEvent(
          completedAppointment.doctorId,
          NotificationCategory.CONSULTATION_COMPLETED,
          JSON.stringify(payload),
        ),
      );

      this.gatewayService.emitToPatient(
        completedAppointment.patientId,
        'consultation_completed',
        payload,
      );
      this.gatewayService.emitToDoctor(
        completedAppointment.doctorId,
        'consultation_completed',
        payload,
      );
    }

    return new StandardResponse(
      false,
      'APPOINTMENT_COMPLETED_SUCCESSFULLY',
      payload,
    );
  }
}

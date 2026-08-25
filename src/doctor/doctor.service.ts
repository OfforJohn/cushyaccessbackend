import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConsultationSchedule } from './models/consultation-schedule.entity';
import { DataSource, In, LessThan, MoreThan, Repository } from 'typeorm';
import { ProfessionDetails } from './models/professional-details.entity';
import { CommonService } from 'src/common/common.service';
import { StandardResponse } from 'src/common/module/standard-response';
import { ConsultationType } from './models/enums/consultation-type.enum';
import { AvailableDoctorsQueryDto } from './DTO/available-doctors.query.dto';
import { Users } from 'src/users/model/users.entity';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { Appointment } from './models/appointment.entity';
import { ConsultationStatus } from './models/enums/consultation-status.enum';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { WalletService } from 'src/wallet/services/wallet.service';
import { TransactionService } from 'src/wallet/services/transaction.service';
import { TransactionCategory } from 'src/wallet/model/transaction-category.enum';
import { TransactionStatus } from 'src/wallet/model/transaction-status.enum';
import { TransactionRequest } from 'src/wallet/model/dto/transaction.request';
import { PushNotificationEvent } from 'src/users/events/push-notification.event';
import { NotificationCategory } from 'src/users/model/notification-category';
import { v4 as uuidv4 } from 'uuid';
import { EventBus } from '@nestjs/cqrs';
import { S3Service } from 'src/utils/s3-bucket.service';
import { ApprovalStatus } from './models/enums/approval-status.enum';
import { CreatePrescriptionDto } from './DTO/create-prescription.dto';
import { Prescription } from './models/prescription.entity';
import { DoctorSignature } from './models/doctor-signature.entity';
import { MailSenderService } from 'src/user-otp/mail-sender.service';
import { ConsultationGatewayService } from './gateways/consultation-gateway.service';

dayjs.extend(utc);
dayjs.extend(timezone);

const PENDING_CONSULTATION_TIMEOUT_MS = 5 * 60 * 1000;
const HEALTH_TIMEZONE = 'Africa/Lagos';

function formatTimeTo12Hour(time24: string): string {
  if (!time24) return '';

  const [hours, minutes, seconds = 0] = time24.split(':').map(Number);
  const hours12 = hours % 12 || 12;
  const minutesStr = minutes.toString().padStart(2, '0');
  const secondsStr = seconds.toString().padStart(2, '0');

  return `${hours12}:${minutesStr}:${secondsStr}`;
}

function formatTimeTo12HourDisplay(time24: string): string {
  if (!time24) return '';

  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours % 12 || 12;
  const minutesStr = minutes.toString().padStart(2, '0');

  return `${hours12}:${minutesStr} ${period}`;
}
@Injectable()
export class DoctorService {
  private readonly logger = new Logger(DoctorService.name);

  constructor(
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,
    @InjectRepository(ConsultationSchedule)
    private readonly scheduleRepo: Repository<ConsultationSchedule>,
    @InjectRepository(Appointment)
    private readonly appointmentRepo: Repository<Appointment>,
    @InjectRepository(ProfessionDetails)
    private readonly professionDetailsRepository: Repository<ProfessionDetails>,
    @InjectRepository(Prescription)
    private readonly prescriptionRepository: Repository<Prescription>,
    @InjectRepository(DoctorSignature)
    private readonly doctorSignatureRepository: Repository<DoctorSignature>,
    private readonly commonService: CommonService,
    private readonly walletService: WalletService,
    private readonly eventBus: EventBus,
    private readonly dataSource: DataSource,
    private readonly s3Service: S3Service,
    private readonly transactionService: TransactionService, // optional
    private readonly mailSenderService: MailSenderService,
    private readonly gatewayService: ConsultationGatewayService,
  ) {}

  async getSchedule() {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const schedule = await this.scheduleRepo.find({
      where: { doctorId: authenticatedUser.id },
      order: { id: 'ASC' },
    });
    return new StandardResponse(
      false,
      'SCHEDULE_RETRIEVED_SUCCESSFULLY',
      schedule,
    );
  }

  async getAvailableDoctors(query: AvailableDoctorsQueryDto) {
    const { consultationType, day, time } = query;

    const qb = this.usersRepo
      .createQueryBuilder('user')
      .innerJoin('user.professionDetails', 'profession')
      .innerJoin(
        ConsultationSchedule,
        'schedule',
        `
                schedule.doctorId = "user"."id"
                AND schedule.day = :day
                AND schedule.isDayOff = false
            `,
        { day },
      )
      .where('user.userRole = :role', {
        role: UserRoles.DOCTOR,
      })
      .andWhere('profession.isAvailable = :isAvailable', {
        isAvailable: true,
      });

    // Optional consultationType filter
    if (consultationType) {
      qb.andWhere('schedule.consultationType = :consultationType', {
        consultationType,
      });
    }

    // Optional time filter
    if (time) {
      qb.andWhere(
        'schedule.openTime <= :time AND schedule.closeTime >= :time',
        { time },
      );
    }

    qb.select([
      'user.id',
      'user.firstName',
      'user.lastName',
      'user.profilePic',
      'profession.professionalBio',
      'schedule.consultationType',
    ]);

    const rows = await qb.getRawMany();

    const doctorsMap = new Map<string, any>();

    for (const row of rows) {
      const doctorId = row.user_id;

      if (!doctorsMap.has(doctorId)) {
        doctorsMap.set(doctorId, {
          id: doctorId,
          firstName: row.user_firstName,
          lastName: row.user_lastName,
          profilePic: row.user_profilePic,
          professionalBio: row.profession_professionalBio || '',
          consultationTypes: [],
        });
      }

      const doctor = doctorsMap.get(doctorId);

      if (
        row.schedule_consultationType &&
        !doctor.consultationTypes.includes(row.schedule_consultationType)
      ) {
        doctor.consultationTypes.push(row.schedule_consultationType);
      }
    }

    const doctors = Array.from(doctorsMap.values());

    return new StandardResponse(
      false,
      'AVAILABLE_DOCTORS_RETRIEVED_SUCCESSFULLY',
      doctors,
    );
  }

  async getDoctorProfileSummary() {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const doctor = await this.usersRepo.findOne({
      where: { id: authenticatedUser.id, userRole: UserRoles.DOCTOR },
      relations: ['professionDetails'],
    });

    if (!doctor) {
      throw new NotFoundException(
        new StandardResponse(true, 'DOCTOR_NOT_FOUND'),
      );
    }

    return new StandardResponse(false, 'DOCTOR_PROFILE_RETRIEVED', {
      id: doctor.id,
      firstName: doctor.firstName,
      lastName: doctor.lastName,
      profilePic: doctor.profilePic,
      professionalBio: doctor.professionDetails?.professionalBio || '',
      specialty: doctor.professionDetails?.specialty || '',
      highestQualification:
        doctor.professionDetails?.highestQualification || '',
      yearOfExperience: doctor.professionDetails?.yearOfExperience || 0,
      medicalInstitution: doctor.professionDetails?.medicalInstitution || '',
    });
  }

  async getPublicDoctorProfile(doctorId: string) {
    const doctor = await this.usersRepo.findOne({
      where: { id: doctorId, userRole: UserRoles.DOCTOR },
      relations: ['professionDetails'],
    });

    if (!doctor) {
      throw new NotFoundException(
        new StandardResponse(true, 'DOCTOR_NOT_FOUND'),
      );
    }

    return new StandardResponse(false, 'DOCTOR_PROFILE_RETRIEVED', {
      id: doctor.id,
      firstName: doctor.firstName,
      lastName: doctor.lastName,
      profilePic: doctor.profilePic,
      professionalBio: doctor.professionDetails?.professionalBio || '',
      specialty: doctor.professionDetails?.specialty || '',
      highestQualification:
        doctor.professionDetails?.highestQualification || '',
      yearOfExperience: doctor.professionDetails?.yearOfExperience || 0,
      medicalInstitution: doctor.professionDetails?.medicalInstitution || '',
    });
  }

  async updateProfessionalBio(professionalBio: string) {
    const trimmedBio = String(professionalBio || '').trim();

    if (!trimmedBio) {
      throw new BadRequestException(
        new StandardResponse(true, 'PROFESSIONAL_BIO_REQUIRED'),
      );
    }

    if (trimmedBio.length > 1000) {
      throw new BadRequestException(
        new StandardResponse(true, 'PROFESSIONAL_BIO_TOO_LONG'),
      );
    }

    const authenticatedUser = await this.commonService.getLoggedInUser();
    const doctor = await this.usersRepo.findOne({
      where: { id: authenticatedUser.id, userRole: UserRoles.DOCTOR },
      relations: ['professionDetails'],
    });

    if (!doctor) {
      throw new NotFoundException(
        new StandardResponse(true, 'DOCTOR_NOT_FOUND'),
      );
    }

    if (!doctor.professionDetails) {
      throw new NotFoundException(
        new StandardResponse(true, 'PROFESSION_DETAILS_NOT_FOUND'),
      );
    }

    doctor.professionDetails.professionalBio = trimmedBio;
    await this.professionDetailsRepository.save(doctor.professionDetails);

    return new StandardResponse(false, 'PROFESSIONAL_BIO_UPDATED', {
      professionalBio: trimmedBio,
    });
  }

  async getAvailability() {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const doctor = await this.usersRepo.findOne({
      where: { id: authenticatedUser.id, userRole: UserRoles.DOCTOR },
      relations: ['professionDetails'],
    });

    if (!doctor) {
      throw new NotFoundException(
        new StandardResponse(true, 'DOCTOR_NOT_FOUND'),
      );
    }

    if (!doctor.professionDetails) {
      throw new NotFoundException(
        new StandardResponse(true, 'PROFESSION_DETAILS_NOT_FOUND'),
      );
    }

    return new StandardResponse(false, 'DOCTOR_AVAILABILITY_RETRIEVED', {
      isAvailable: doctor.professionDetails.isAvailable,
    });
  }

  async updateAvailability(isAvailable: boolean) {
    if (typeof isAvailable !== 'boolean') {
      throw new BadRequestException(
        new StandardResponse(true, 'IS_AVAILABLE_MUST_BE_BOOLEAN'),
      );
    }

    const authenticatedUser = await this.commonService.getLoggedInUser();
    const doctor = await this.usersRepo.findOne({
      where: { id: authenticatedUser.id, userRole: UserRoles.DOCTOR },
      relations: ['professionDetails'],
    });

    if (!doctor) {
      throw new NotFoundException(
        new StandardResponse(true, 'DOCTOR_NOT_FOUND'),
      );
    }

    if (!doctor.professionDetails) {
      throw new NotFoundException(
        new StandardResponse(true, 'PROFESSION_DETAILS_NOT_FOUND'),
      );
    }

    doctor.professionDetails.isAvailable = isAvailable;
    await this.professionDetailsRepository.save(doctor.professionDetails);

    return new StandardResponse(false, 'DOCTOR_AVAILABILITY_UPDATED', {
      isAvailable,
    });
  }

  //Get new appointment
  async getNewAppointments() {
    const authenticatedUser = await this.commonService.getLoggedInUser();

    const doctor = await this.usersRepo.findOne({
      where: { id: authenticatedUser.id, userRole: UserRoles.DOCTOR },
      relations: ['professionDetails'],
    });

    if (!doctor) {
      return new StandardResponse(true, 'DOCTOR_NOT_FOUND');
    }

    return new StandardResponse(
      false,
      'NEW_APPOINTMENTS_RETRIEVED_SUCCESSFULLY',
      [],
    );
  }
  //Get scheduled appointment
  async getScheduledAppointments() {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    await this.expirePastScheduledAppointments();

    const scheduledAppointments = await this.appointmentRepo.find({
      where: {
        doctorId: authenticatedUser.id,
        status: In([
          ConsultationStatus.BOOKED,
          ConsultationStatus.ACKNOWLEDGED,
        ]),
      },
      relations: ['doctor', 'doctor.professionDetails', 'patient'],
      order: { id: 'DESC' },
    });
    return new StandardResponse(
      false,
      'SCHEDULED_APPOINTMENTS_RETRIEVED_SUCCESSFULLY',
      await this.mapAppointmentListItems(scheduledAppointments),
    );
  }
  //Get completed appointment
  async getCompletedAppointments() {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const completedAppointments = await this.appointmentRepo.find({
      where: {
        doctorId: authenticatedUser.id,
        status: ConsultationStatus.COMPLETED,
      },
      relations: ['doctor', 'doctor.professionDetails', 'patient'],
      order: { id: 'DESC' },
    });
    return new StandardResponse(
      false,
      'COMPLETED_APPOINTMENTS_RETRIEVED_SUCCESSFULLY',
      await this.mapAppointmentListItems(completedAppointments),
    );
  }
  //Get cancelled appointment
  async getCancelledAppointments() {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    await this.expirePastScheduledAppointments();

    const cancelledAppointments = await this.appointmentRepo.find({
      where: {
        doctorId: authenticatedUser.id,
        status: In([
          ConsultationStatus.CANCELLED,
          ConsultationStatus.REJECTED,
          ConsultationStatus.EXPIRED,
        ]),
      },
      relations: ['doctor', 'doctor.professionDetails', 'patient'],
      order: { id: 'DESC' },
    });
    return new StandardResponse(
      false,
      'CANCELLED_APPOINTMENTS_RETRIEVED_SUCCESSFULLY',
      await this.mapAppointmentListItems(cancelledAppointments),
    );
  }
  //Get ongoing appointment
  async getOngoingAppointments() {
    const authenticatedUser = await this.commonService.getLoggedInUser();

    const now = dayjs().tz(HEALTH_TIMEZONE);
    const currentDate = now.format('YYYY-MM-DD');
    const currentTime = now.format('HH:mm:ss');

    const ongoingAppointments = await this.appointmentRepo
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.doctor', 'doctor')
      .leftJoinAndSelect('doctor.professionDetails', 'doctorProfession')
      .leftJoinAndSelect('appointment.patient', 'patient')
      .where('appointment.doctorId = :doctorId', {
        doctorId: authenticatedUser.id,
      })
      .andWhere('appointment.date = :currentDate', {
        currentDate,
      })
      .andWhere('appointment.startTime <= :currentTime', {
        currentTime,
      })
      .andWhere('appointment.endTime >= :currentTime', {
        currentTime,
      })
      .andWhere('appointment.status IN (:...statuses)', {
        statuses: [ConsultationStatus.ACTIVE],
      })
      .orderBy('appointment.startTime', 'ASC')
      .getMany();

    return new StandardResponse(
      false,
      'ONGOING_APPOINTMENTS_RETRIEVED_SUCCESSFULLY',
      await this.mapAppointmentListItems(ongoingAppointments),
    );
  }

  //Get User Upcoming Appointments
  async getUpcomingAppointments() {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    await this.expirePastScheduledAppointments();

    const now = dayjs().tz(HEALTH_TIMEZONE);
    const currentDate = now.format('YYYY-MM-DD');

    const upcomingAppointments = await this.appointmentRepo
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.doctor', 'doctor')
      .leftJoinAndSelect('doctor.professionDetails', 'doctorProfession')
      .leftJoinAndSelect('appointment.patient', 'patient')
      .where('appointment.patientId = :patientId', {
        patientId: authenticatedUser.id,
      })
      .andWhere('appointment.status IN (:...statuses)', {
        statuses: [
          ConsultationStatus.BOOKED,
          ConsultationStatus.ACKNOWLEDGED,
          ConsultationStatus.PENDING_ACCEPTANCE,
        ],
      })
      .andWhere(
        '(appointment.date >= :currentDate OR appointment.date IS NULL)',
        { currentDate },
      )
      .orderBy('appointment.id', 'DESC')
      .getMany();

    // Transform to include only needed fields and full names
    const transformed = upcomingAppointments.map((apt) => {
      // Create a new object with only the appointment fields you want
      const appointmentData: any = {
        id: apt.id,
        doctorId: apt.doctorId,
        patientId: apt.patientId,
        consultationType: apt.consultationType,
        day: apt.day,
        consultationAmount: apt.consultationAmount,
        date: apt.date,
        startTime: formatTimeTo12Hour(apt.startTime),
        endTime: formatTimeTo12Hour(apt.endTime),
        startTimeDisplay: formatTimeTo12HourDisplay(apt.startTime), // Optional: for UI display
        endTimeDisplay: formatTimeTo12HourDisplay(apt.endTime), // Optional: for UI display
        status: apt.status,
        meetingLink: apt.patientMeetingLink || apt.meetingLink,
        patientMeetingLink: apt.patientMeetingLink,
        doctorMeetingLink: apt.doctorMeetingLink,
        reminder24hSent: apt.reminder24hSent,
        reminder1hSent: apt.reminder1hSent,
        reminder15mSent: apt.reminder15mSent,
        lastReminderSentAt: apt.lastReminderSentAt,
        createdAt: apt.createdAt,
        // Add the full names
        doctorFullName: apt.doctor
          ? `Dr. ${apt.doctor.firstName} ${apt.doctor.lastName}`
          : null,
        doctorProfilePic: apt.doctor ? apt.doctor.profilePic : null,
        doctorProfessionalBio:
          apt.doctor?.professionDetails?.professionalBio || '',
        patientFullName: apt.patient
          ? `${apt.patient.firstName} ${apt.patient.lastName}`
          : null,
      };

      return appointmentData;
    });

    return new StandardResponse(
      false,
      'UPCOMING_APPOINTMENTS_RETRIEVED_SUCCESSFULLY',
      transformed,
    );
  }
  //Get User Past Appointments
  async getPastAppointments() {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    await this.expirePastScheduledAppointments();

    const pastAppointments = await this.appointmentRepo.find({
      where: {
        patientId: authenticatedUser.id,
        status: In([
          ConsultationStatus.COMPLETED,
          ConsultationStatus.CANCELLED,
          ConsultationStatus.REJECTED,
          ConsultationStatus.EXPIRED,
        ]),
      },
      relations: ['doctor', 'doctor.professionDetails', 'patient'],
      order: { id: 'DESC' },
    });
    return new StandardResponse(
      false,
      'PAST_APPOINTMENTS_RETRIEVED_SUCCESSFULLY',
      await this.mapAppointmentListItems(pastAppointments),
    );
  }

  private async expirePastScheduledAppointments(): Promise<void> {
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
      `Expired ${expiredAppointments.length} scheduled appointment(s) while loading appointment lists`,
    );
  }

  private getPendingExpiresAt(appointment: Appointment): Date {
    return (
      appointment.expiresAt ||
      new Date(
        new Date(appointment.createdAt).getTime() +
          PENDING_CONSULTATION_TIMEOUT_MS,
      )
    );
  }

  private getPendingSecondsRemaining(appointment: Appointment): number {
    return Math.max(
      0,
      Math.ceil(
        (this.getPendingExpiresAt(appointment).getTime() - Date.now()) / 1000,
      ),
    );
  }

  private formatDuration(seconds: number): string {
    const safeSeconds = Math.max(0, seconds);
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  private getAppointmentActivityTimestamp(appointment: Appointment): number {
    const scheduledAt =
      appointment.date && appointment.startTime
        ? `${appointment.date}T${appointment.startTime}`
        : undefined;
    const candidates = [
      appointment.completedAt,
      appointment.acceptedAt,
      scheduledAt,
      appointment.createdAt,
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      const timestamp = new Date(candidate as any).getTime();
      if (Number.isFinite(timestamp)) return timestamp;
    }

    return 0;
  }

  private getPrescriptionSummary(prescription?: Prescription) {
    if (!prescription) return null;

    const medications = Array.isArray(prescription.medications)
      ? prescription.medications
      : [];

    return {
      diagnosis: prescription.diagnosis || '',
      notes: prescription.notes || '',
      medications,
      medicationSummary: medications
        .map((med) =>
          [med.name, med.dosage, med.frequency, med.duration]
            .filter(Boolean)
            .join(' - '),
        )
        .filter(Boolean)
        .join('; '),
      prescribedDate: prescription.prescribedDate,
    };
  }

  private async mapAppointmentListItems(appointments: Appointment[]) {
    if (!appointments.length) return [];

    const appointmentIds = appointments.map((appointment) => appointment.id);
    const prescriptions = await this.prescriptionRepository.find({
      where: { appointmentId: In(appointmentIds) },
      order: { prescribedDate: 'DESC' },
    });
    const prescriptionsByAppointmentId = new Map<string, Prescription>();

    prescriptions.forEach((prescription) => {
      if (!prescriptionsByAppointmentId.has(prescription.appointmentId)) {
        prescriptionsByAppointmentId.set(
          prescription.appointmentId,
          prescription,
        );
      }
    });

    return appointments
      .map((appointment) => {
        const doctor = appointment.doctor;
        const patient = appointment.patient;
        const prescription = prescriptionsByAppointmentId.get(appointment.id);
        const durationSeconds = appointment.acceptedAt
          ? Math.max(
              0,
              Math.round(
                ((appointment.completedAt
                  ? new Date(appointment.completedAt)
                  : new Date()
                ).getTime() -
                  new Date(appointment.acceptedAt).getTime()) /
                  1000,
              ),
            )
          : 0;
        const consultationFee = Number(appointment.consultationAmount || 0);
        const platformCommission = consultationFee * 0.2;

        return {
          id: appointment.id,
          doctorId: appointment.doctorId,
          patientId: appointment.patientId,
          consultationType: appointment.consultationType,
          type: appointment.consultationType,
          day: appointment.day,
          consultationAmount: consultationFee,
          consultationFee,
          date: appointment.date,
          startTime: appointment.startTime,
          endTime: appointment.endTime,
          startTimeDisplay: formatTimeTo12HourDisplay(appointment.startTime),
          endTimeDisplay: formatTimeTo12HourDisplay(appointment.endTime),
          status: appointment.status,
          meetingLink:
            appointment.doctorMeetingLink ||
            appointment.meetingLink ||
            appointment.patientMeetingLink,
          doctorMeetingLink: appointment.doctorMeetingLink,
          patientMeetingLink: appointment.patientMeetingLink,
          roomId: appointment.roomName,
          meetingProvider: appointment.meetingProvider,
          createdAt: appointment.createdAt,
          acceptedAt: appointment.acceptedAt,
          completedAt: appointment.completedAt,
          expiresAt: appointment.expiresAt,
          timeAndDate:
            appointment.completedAt ||
            appointment.acceptedAt ||
            appointment.createdAt,
          activityTimestamp: this.getAppointmentActivityTimestamp(appointment),
          durationSeconds,
          videoDuration: this.formatDuration(durationSeconds),
          doctorFullName: doctor
            ? `Dr. ${doctor.firstName} ${doctor.lastName}`.trim()
            : appointment.doctorName || 'Doctor',
          doctorName: doctor
            ? `Dr. ${doctor.firstName} ${doctor.lastName}`.trim()
            : appointment.doctorName || 'Doctor',
          doctorProfilePic: doctor?.profilePic || null,
          doctorProfessionalBio:
            doctor?.professionDetails?.professionalBio || '',
          patientFullName: patient
            ? `${patient.firstName} ${patient.lastName}`.trim()
            : appointment.patientName || 'Patient',
          patientName: patient
            ? `${patient.firstName} ${patient.lastName}`.trim()
            : appointment.patientName || 'Patient',
          patientProfilePic: patient?.profilePic || null,
          prescriptionGiven: Boolean(prescription),
          prescription: this.getPrescriptionSummary(prescription),
          paymentBreakdown: {
            consultationFee,
            platformCommission,
            doctorEarnings: consultationFee - platformCommission,
            currency: 'NGN',
          },
        };
      })
      .sort((a, b) => b.activityTimestamp - a.activityTimestamp);
  }

  async expirePendingConsultationsForUser(userId: string) {
    const now = new Date();
    const cutoff = new Date(Date.now() - PENDING_CONSULTATION_TIMEOUT_MS);
    const staleAppointments = await this.appointmentRepo.find({
      where: [
        {
          patientId: userId,
          status: ConsultationStatus.PENDING_ACCEPTANCE,
          expiresAt: LessThan(now),
        },
        {
          patientId: userId,
          status: ConsultationStatus.PENDING_ACCEPTANCE,
          createdAt: LessThan(cutoff),
        },
        {
          doctorId: userId,
          status: ConsultationStatus.PENDING_ACCEPTANCE,
          expiresAt: LessThan(now),
        },
        {
          doctorId: userId,
          status: ConsultationStatus.PENDING_ACCEPTANCE,
          createdAt: LessThan(cutoff),
        },
      ],
    });

    if (!staleAppointments.length) return [];

    staleAppointments.forEach((appointment) => {
      appointment.status = ConsultationStatus.EXPIRED;
      appointment.expiresAt = this.getPendingExpiresAt(appointment);
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

    return saved;
  }

  private async mapConsultationLifecycle(
    appointment: Appointment,
    userId: string,
  ) {
    const doctor =
      appointment.doctor ||
      (await this.usersRepo.findOne({ where: { id: appointment.doctorId } }));
    const patient =
      appointment.patient ||
      (await this.usersRepo.findOne({ where: { id: appointment.patientId } }));
    const role = appointment.doctorId === userId ? 'doctor' : 'patient';
    const durationSeconds = appointment.acceptedAt
      ? Math.max(
          0,
          Math.round(
            ((appointment.completedAt
              ? new Date(appointment.completedAt)
              : new Date()
            ).getTime() -
              new Date(appointment.acceptedAt).getTime()) /
              1000,
          ),
        )
      : 0;

    return {
      appointmentId: appointment.id,
      status: appointment.status,
      locked: [
        ConsultationStatus.PENDING_ACCEPTANCE,
        ConsultationStatus.ACTIVE,
      ].includes(appointment.status),
      role,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      doctorName: doctor
        ? `Dr. ${doctor.firstName} ${doctor.lastName}`
        : appointment.doctorName,
      patientName: patient
        ? `${patient.firstName} ${patient.lastName}`
        : appointment.patientName,
      consultationType: appointment.consultationType,
      consultationFee: Number(appointment.consultationAmount || 0),
      meetingLink:
        role === 'doctor'
          ? appointment.doctorMeetingLink
          : appointment.patientMeetingLink,
      doctorMeetingLink: appointment.doctorMeetingLink,
      patientMeetingLink: appointment.patientMeetingLink,
      roomId: appointment.roomName,
      requestedAt: appointment.createdAt,
      expiresAt: this.getPendingExpiresAt(appointment),
      secondsRemaining:
        appointment.status === ConsultationStatus.PENDING_ACCEPTANCE
          ? this.getPendingSecondsRemaining(appointment)
          : 0,
      acceptedAt: appointment.acceptedAt,
      completedAt: appointment.completedAt,
      durationSeconds,
      videoDuration: this.formatDuration(durationSeconds),
    };
  }

  async getActiveConsultationForCurrentUser() {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    await this.expirePendingConsultationsForUser(authenticatedUser.id);

    const activeAppointment = await this.appointmentRepo
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.doctor', 'doctor')
      .leftJoinAndSelect('appointment.patient', 'patient')
      .where(
        '(appointment.patientId = :userId OR appointment.doctorId = :userId)',
        {
          userId: authenticatedUser.id,
        },
      )
      .andWhere('appointment.status IN (:...statuses)', {
        statuses: [
          ConsultationStatus.PENDING_ACCEPTANCE,
          ConsultationStatus.ACTIVE,
        ],
      })
      .orderBy('appointment.createdAt', 'DESC')
      .getOne();

    if (activeAppointment) {
      return new StandardResponse(
        false,
        'ACTIVE_CONSULTATION_FETCHED',
        await this.mapConsultationLifecycle(
          activeAppointment,
          authenticatedUser.id,
        ),
      );
    }

    const latestExpired = await this.appointmentRepo
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.doctor', 'doctor')
      .leftJoinAndSelect('appointment.patient', 'patient')
      .where(
        '(appointment.patientId = :userId OR appointment.doctorId = :userId)',
        {
          userId: authenticatedUser.id,
        },
      )
      .andWhere('appointment.status = :status', {
        status: ConsultationStatus.EXPIRED,
      })
      .andWhere('appointment.createdAt > :recentCutoff', {
        recentCutoff: new Date(Date.now() - 30 * 60 * 1000),
      })
      .orderBy('appointment.createdAt', 'DESC')
      .getOne();

    if (latestExpired) {
      return new StandardResponse(
        false,
        'LATEST_CONSULTATION_EXPIRED',
        await this.mapConsultationLifecycle(
          latestExpired,
          authenticatedUser.id,
        ),
      );
    }

    return new StandardResponse(false, 'NO_ACTIVE_CONSULTATION', null);
  }

  async getConsultationSummary(appointmentId: string) {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const appointment = await this.appointmentRepo.findOne({
      where: { id: appointmentId },
      relations: ['doctor', 'patient'],
    });

    if (!appointment) {
      throw new NotFoundException(
        new StandardResponse(true, 'APPOINTMENT_NOT_FOUND'),
      );
    }

    if (
      appointment.patientId !== authenticatedUser.id &&
      appointment.doctorId !== authenticatedUser.id
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'UNAUTHORIZED_CONSULTATION_ACCESS'),
      );
    }

    const prescription = await this.prescriptionRepository.findOne({
      where: { appointmentId },
    });
    const durationSeconds = appointment.acceptedAt
      ? Math.max(
          0,
          Math.round(
            ((appointment.completedAt
              ? new Date(appointment.completedAt)
              : new Date()
            ).getTime() -
              new Date(appointment.acceptedAt).getTime()) /
              1000,
          ),
        )
      : 0;

    return new StandardResponse(false, 'CONSULTATION_SUMMARY_FETCHED', {
      appointmentId: appointment.id,
      status: appointment.status,
      prescriptionGiven: Boolean(prescription),
      prescription,
      timeAndDate:
        appointment.completedAt ||
        appointment.acceptedAt ||
        appointment.createdAt,
      videoDuration: this.formatDuration(durationSeconds),
      durationSeconds,
      patientName: appointment.patient
        ? `${appointment.patient.firstName} ${appointment.patient.lastName}`
        : appointment.patientName,
      doctorName: appointment.doctor
        ? `Dr. ${appointment.doctor.firstName} ${appointment.doctor.lastName}`
        : appointment.doctorName,
      consultationType: appointment.consultationType,
      consultationFee: Number(appointment.consultationAmount || 0),
      acceptedAt: appointment.acceptedAt,
      completedAt: appointment.completedAt,
      meetingProvider: appointment.meetingProvider,
    });
  }

  async cancelCurrentPendingConsultation() {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    await this.expirePendingConsultationsForUser(authenticatedUser.id);

    const pendingAppointments = await this.appointmentRepo.find({
      where: {
        patientId: authenticatedUser.id,
        status: ConsultationStatus.PENDING_ACCEPTANCE,
      },
      order: { createdAt: 'DESC' },
    });

    if (!pendingAppointments.length) {
      return new StandardResponse(false, 'NO_PENDING_CONSULTATION_TO_CANCEL', {
        cancelledCount: 0,
      });
    }

    pendingAppointments.forEach((appointment) => {
      appointment.status = ConsultationStatus.CANCELLED;
    });

    const saved = await this.appointmentRepo.save(pendingAppointments);
    const patientName =
      `${authenticatedUser.firstName} ${authenticatedUser.lastName}`.trim();

    saved.forEach((appointment) => {
      const payload = {
        appointmentId: appointment.id,
        status: ConsultationStatus.CANCELLED,
        patientName,
      };

      this.gatewayService.emitToDoctor(
        appointment.doctorId,
        'consultation_cancelled',
        payload,
      );
      this.gatewayService.emitToPatient(
        appointment.patientId,
        'consultation_cancelled',
        payload,
      );
      this.eventBus.publish(
        new PushNotificationEvent(
          appointment.doctorId,
          NotificationCategory.CONSULTATION_CANCELLED,
          JSON.stringify(payload),
        ),
      );
    });

    return new StandardResponse(false, 'CONSULTATION_CANCELLED_SUCCESSFULLY', {
      cancelledCount: saved.length,
      appointmentIds: saved.map((appointment) => appointment.id),
    });
  }

  //Cancel Appointment by User
  async cancelAppointmentByUser(appointmentId: string) {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const appointment = await this.appointmentRepo.findOne({
      where: { id: appointmentId, patientId: authenticatedUser.id },
    });
    if (!appointment) {
      return new StandardResponse(true, 'APPOINTMENT_NOT_FOUND', {});
    }
    if (
      [
        ConsultationStatus.CANCELLED,
        ConsultationStatus.REJECTED,
        ConsultationStatus.EXPIRED,
      ].includes(appointment.status)
    ) {
      return new StandardResponse(
        true,
        `APPOINTMENT_ALREADY_${appointment.status}`,
        {},
      );
    }
    if (appointment.status === ConsultationStatus.COMPLETED) {
      return new StandardResponse(true, 'APPOINTMENT_ALREADY_COMPLETED', {});
    }
    if (appointment.status === ConsultationStatus.ACTIVE) {
      return new StandardResponse(
        true,
        'USE_END_CALL_TO_COMPLETE_ACTIVE_CONSULTATION',
        {},
      );
    }

    appointment.status = ConsultationStatus.CANCELLED;
    appointment.reminder24hSent = true;
    appointment.reminder1hSent = true;
    appointment.reminder15mSent = true;
    appointment.reminderStartSent = true;
    appointment.lastReminderSentAt = new Date();
    await this.appointmentRepo.save(appointment);

    const payload = {
      appointmentId: appointment.id,
      status: ConsultationStatus.CANCELLED,
      patientName:
        `${authenticatedUser.firstName} ${authenticatedUser.lastName}`.trim(),
    };

    this.gatewayService.emitToDoctor(
      appointment.doctorId,
      'consultation_cancelled',
      payload,
    );
    this.eventBus.publish(
      new PushNotificationEvent(
        appointment.doctorId,
        NotificationCategory.CONSULTATION_CANCELLED,
        JSON.stringify(payload),
      ),
    );

    return new StandardResponse(
      false,
      'APPOINTMENT_CANCELLED_SUCCESSFULLY',
      {},
    );
  }
  //acknolegde appointment
  async acknowledgeAppointment(appointmentId: string) {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const appointment = await this.appointmentRepo.findOne({
      where: { id: appointmentId, doctorId: authenticatedUser.id },
    });
    if (!appointment) {
      return new StandardResponse(true, 'APPOINTMENT_NOT_FOUND', {});
    }
    if (appointment.status === ConsultationStatus.ACKNOWLEDGED) {
      return new StandardResponse(true, 'APPOINTMENT_ALREADY_ACKNOWLEDGED', {});
    }
    await this.appointmentRepo.update(
      { id: appointmentId },
      { status: ConsultationStatus.ACKNOWLEDGED },
    );
    return new StandardResponse(
      false,
      'APPOINTMENT_ACKNOWLEDGED_SUCCESSFULLY',
      {},
    );
  }
  //Reject Appointment by Doctor
  async rejectAppointmentByDoctor(appointmentId: string) {
    const authenticatedUser = await this.commonService.getLoggedInUser();

    const appointment = await this.appointmentRepo.findOne({
      where: {
        id: appointmentId,
        doctorId: authenticatedUser.id,
      },
    });

    if (!appointment) {
      return new StandardResponse(true, 'APPOINTMENT_NOT_FOUND', {});
    }

    if (
      appointment.status === ConsultationStatus.ACKNOWLEDGED ||
      appointment.status === ConsultationStatus.ACTIVE ||
      appointment.status === ConsultationStatus.COMPLETED
    ) {
      return new StandardResponse(
        true,
        'CANNOT_REJECT_CONFIRMED_APPOINTMENT',
        {},
      );
    }

    if (appointment.status === ConsultationStatus.REJECTED) {
      return new StandardResponse(true, 'APPOINTMENT_ALREADY_REJECTED', {});
    }

    if (appointment.status === ConsultationStatus.CANCELLED) {
      return new StandardResponse(true, 'APPOINTMENT_ALREADY_CANCELLED', {});
    }

    appointment.status = ConsultationStatus.REJECTED;
    appointment.reminder24hSent = true;
    appointment.reminder1hSent = true;
    appointment.reminder15mSent = true;
    appointment.reminderStartSent = true;
    appointment.lastReminderSentAt = new Date();
    await this.appointmentRepo.save(appointment);

    this.eventBus.publish(
      new PushNotificationEvent(
        appointment.patientId,
        NotificationCategory.APPOINTMENT_REJECTED,
        JSON.stringify({
          body: 'Your appointment has been rejected by the doctor.',
          appointmentId: appointment.id,
        }),
      ),
    );

    this.gatewayService.emitToPatient(
      appointment.patientId,
      'consultation_rejected',
      {
        appointmentId: appointment.id,
        status: ConsultationStatus.REJECTED,
        doctorId: appointment.doctorId,
      },
    );

    return new StandardResponse(false, 'APPOINTMENT_REJECTED_SUCCESSFULLY', {});
  }
  /**
   * Global health consultation fee. Admin-only (see controller). A single fee
   * applies to every doctor, so this overwrites consultationFee on ALL
   * profession_details rows in one statement. Doctors no longer set their own.
   */
  async updateConsultationFee(newFee: number) {
    const fee = Number(newFee);
    if (newFee === undefined || newFee === null || isNaN(fee) || fee < 0) {
      this.logger.warn(
        `Rejected invalid global consultation fee update: ${newFee}`,
      );
      return new StandardResponse(true, 'INVALID_CONSULTATION_FEE', {});
    }

    // Capture who made the change + the previous value for the audit log.
    const admin = await this.commonService.getLoggedInUser();
    const previous = await this.professionDetailsRepository
      .createQueryBuilder('pd')
      .where('pd.consultationFee IS NOT NULL')
      .orderBy('pd.consultationFee', 'DESC')
      .getOne();
    const previousFee =
      previous?.consultationFee != null
        ? Number(previous.consultationFee)
        : null;

    const result = await this.professionDetailsRepository
      .createQueryBuilder()
      .update(ProfessionDetails)
      .set({ consultationFee: fee })
      .execute();
    const updatedDoctors = result.affected ?? 0;

    this.logger.log(
      `Global consultation fee changed ${previousFee ?? 'unset'} -> ${fee} ` +
        `by admin ${admin?.email || admin?.id || 'unknown'} (${updatedDoctors} doctor(s) updated)`,
    );

    return new StandardResponse(
      false,
      'CONSULTATION_FEE_UPDATED_SUCCESSFULLY',
      {
        consultationFee: fee,
        previousFee,
        updatedDoctors,
      },
    );
  }

  /**
   * Public read of the current global consultation fee. The mobile app uses
   * this so its pre-booking balance gate tracks the admin-set fee live (no
   * caching / no re-login). All doctors share one fee; we take the highest
   * non-null so a freshly created doctor's default never masks the real value.
   */
  async getGlobalConsultationFee() {
    const details = await this.professionDetailsRepository
      .createQueryBuilder('pd')
      .where('pd.consultationFee IS NOT NULL')
      .orderBy('pd.consultationFee', 'DESC')
      .getOne();
    const fee =
      details?.consultationFee != null ? Number(details.consultationFee) : 0;
    return new StandardResponse(false, 'CONSULTATION_FEE_FETCHED', {
      consultationFee: fee,
    });
  }
  async uploadDoctorProfilePicture(file: Express.Multer.File) {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const doctor = await this.usersRepo.findOne({
      where: { id: authenticatedUser.id, userRole: UserRoles.DOCTOR },
    });
    if (!doctor) {
      throw new NotFoundException(
        new StandardResponse(true, 'DOCTOR_NOT_FOUND'),
      );
    }
    const result = await this.s3Service.uploadDoctorProfileWithMetadata(file, {
      doctorId: doctor.id,
    });
    doctor.profilePic = result.url;
    await this.usersRepo.save(doctor);
    return new StandardResponse(false, 'PROFILE_PICTURE_UPLOADED_SUCCESSFULLY');
  }

  //Admin Dashboard - Get all doctors
  async getAllDoctors() {
    const doctors = await this.usersRepo.find({
      where: { userRole: UserRoles.DOCTOR },
      relations: ['professionDetails'],
      order: { id: 'DESC' },
    });

    // Remove password from each doctor while keeping all other fields
    const doctorsWithoutPassword = doctors.map((doctor) => {
      const { password, ...doctorWithoutPassword } = doctor;
      return doctorWithoutPassword;
    });

    return new StandardResponse(
      false,
      'DOCTORS_RETRIEVED_SUCCESSFULLY',
      doctorsWithoutPassword,
    );
  }

  async getDoctorsByCategory(category: string) {
    const doctors = await this.usersRepo.find({
      where: {
        userRole: UserRoles.DOCTOR,
        professionDetails: {
          specialty: category,
          approvalStatus: ApprovalStatus.APPROVED,
          isAvailable: true,
        },
      },
      relations: ['professionDetails'],
      order: { id: 'DESC' },
    });

    // Remove password from each doctor while keeping all other fields
    const doctorsWithoutPassword = doctors.map((doctor) => {
      const { password, ...doctorWithoutPassword } = doctor;
      return doctorWithoutPassword;
    });

    return new StandardResponse(
      false,
      'DOCTORS_RETRIEVED_SUCCESSFULLY',
      doctorsWithoutPassword,
    );
  }

  async getAllAppointments(statusFilter?: ConsultationStatus) {
    const schedules = await this.appointmentRepo.find({
      where: { status: statusFilter },
      order: { id: 'ASC' },
    });
    return new StandardResponse(
      false,
      'CONSULTATION_SCHEDULES_RETRIEVED_SUCCESSFULLY',
      schedules,
    );
  }
  async getAllAppointmentsStats() {
    const totalAppointments = await this.appointmentRepo.count();
    const bookedAppointments = await this.appointmentRepo.count({
      where: { status: ConsultationStatus.BOOKED },
    });
    const acknowledgedAppointments = await this.appointmentRepo.count({
      where: { status: ConsultationStatus.ACKNOWLEDGED },
    });
    const completedAppointments = await this.appointmentRepo.count({
      where: { status: ConsultationStatus.COMPLETED },
    });
    const cancelledAppointments = await this.appointmentRepo.count({
      where: { status: ConsultationStatus.CANCELLED },
    });
    const rejectedAppointments = await this.appointmentRepo.count({
      where: { status: ConsultationStatus.REJECTED },
    });
    const expiredAppointments = await this.appointmentRepo.count({
      where: { status: ConsultationStatus.EXPIRED },
    });
    return new StandardResponse(
      false,
      'APPOINTMENTS_STATS_RETRIEVED_SUCCESSFULLY',
      {
        totalAppointments,
        bookedAppointments,
        acknowledgedAppointments,
        completedAppointments,
        cancelledAppointments,
        rejectedAppointments,
        expiredAppointments,
      },
    );
  }

  //Admin Dashboard - Get all doctors with pending verification
  async getDoctorsWithPendingVerification() {
    const pendingDoctors = await this.usersRepo.find({
      where: {
        userRole: UserRoles.DOCTOR,
        professionDetails: { approvalStatus: ApprovalStatus.PENDING },
      },
      relations: ['professionDetails'],
      order: { id: 'DESC' },
    });
    return new StandardResponse(
      false,
      'DOCTORS_WITH_PENDING_VERIFICATION_RETRIEVED_SUCCESSFULLY',
      pendingDoctors,
    );
  }

  async verifyDoctor(doctorId: string, approvalStatus: ApprovalStatus) {
    const doctor = await this.usersRepo.findOne({
      where: { id: doctorId, userRole: UserRoles.DOCTOR },
      relations: ['professionDetails'],
    });
    if (!doctor) {
      throw new NotFoundException(
        new StandardResponse(true, 'DOCTOR_NOT_FOUND'),
      );
    }
    if (!doctor.professionDetails) {
      throw new NotFoundException(
        new StandardResponse(true, 'PROFESSION_DETAILS_NOT_FOUND'),
      );
    }
    doctor.professionDetails.approvalStatus = approvalStatus;
    await this.professionDetailsRepository.save(doctor.professionDetails);
    //Send notification to doctor about verification status
    this.eventBus.publish(
      new PushNotificationEvent(
        doctor.id,
        NotificationCategory.DOCTOR_VERIFICATION_STATUS_UPDATED,
        `Your profile has been ${approvalStatus} by admin. Kindly login to your account and start accepting consultations.`,
      ),
    );
    const emailContent = {
      doctorName: doctor.firstName + ' ' + doctor.lastName,
      verificationDate: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      specialty: doctor.professionDetails.specialty,
    };
    await this.mailSenderService.sendMail({
      recipient: doctor.email,
      subject: 'Doctor Verification Status Update',
      template: 'doctor-verification',
      content: emailContent,
    });
    return new StandardResponse(
      false,
      'DOCTOR_VERIFICATION_STATUS_UPDATED_SUCCESSFULLY',
    );
  }

  async getVerificationStatus(doctorId: string) {
    const doctor = await this.usersRepo.findOne({
      where: { id: doctorId, userRole: UserRoles.DOCTOR },
      relations: ['professionDetails'],
    });
    if (!doctor) {
      throw new NotFoundException(
        new StandardResponse(true, 'DOCTOR_NOT_FOUND'),
      );
    }
    if (!doctor.professionDetails) {
      throw new NotFoundException(
        new StandardResponse(true, 'PROFESSION_DETAILS_NOT_FOUND'),
      );
    }

    const status = doctor.professionDetails.approvalStatus;

    return new StandardResponse(false, 'VERIFICATION_STATUS_RETRIEVED', {
      doctorId: doctor.id,
      approvalStatus: status,
      isVerified: status === ApprovalStatus.APPROVED,
      isRejected: status === ApprovalStatus.REJECTED,
      isPending: status === ApprovalStatus.PENDING,
      isAvailable: doctor.professionDetails.isAvailable,
    });
  }

  async createPrescription(
    payload: CreatePrescriptionDto,
    signatureFile?: Express.Multer.File,
  ) {
    // Debug: Log the entire payload
    console.log('========== BACKEND RECEIVED PAYLOAD ==========');
    console.log('Payload:', JSON.stringify(payload, null, 2));
    console.log('appointmentId type:', typeof payload.appointmentId);
    console.log('appointmentId value:', payload.appointmentId);
    console.log('Signature file present:', !!signatureFile);

    const authenticatedUser = await this.commonService.getLoggedInUser();

    // Validate appointmentId exists
    if (!payload.appointmentId) {
      console.error('appointmentId is missing or null!');
      throw new BadRequestException('appointmentId is required');
    }

    // Check for existing prescription for this appointment
    const existingPrescription = await this.prescriptionRepository.findOne({
      where: { appointmentId: payload.appointmentId },
    });

    if (existingPrescription) {
      return new StandardResponse(
        true,
        'PRESCRIPTION_ALREADY_EXISTS_FOR_THIS_APPOINTMENT',
        null,
      );
    }

    let signatureUrl: string;

    const doctorSignature = await this.doctorSignatureRepository.findOne({
      where: { doctorId: authenticatedUser.id },
    });

    if (doctorSignature) {
      signatureUrl = doctorSignature.signatureUrl;
      console.log(
        `Reusing existing signature for doctor: ${authenticatedUser.id}`,
      );
    } else if (signatureFile) {
      const signatureUrls = await this.s3Service.uploadDoctorSignature([
        signatureFile,
      ]);
      signatureUrl = signatureUrls[0];

      await this.doctorSignatureRepository.save({
        doctorId: authenticatedUser.id,
        signatureUrl: signatureUrl,
        uploadedAt: new Date(),
      });

      console.log(`New signature uploaded for doctor: ${authenticatedUser.id}`);
    } else {
      throw new BadRequestException(
        'Signature is required for first-time setup',
      );
    }

    // IMPORTANT: Include 'doctor' relation for email
    const appointment = await this.appointmentRepo.findOne({
      where: {
        id: payload.appointmentId,
        doctorId: authenticatedUser.id,
      },
      relations: ['doctor', 'patient'], // Add this to get doctor and patient details
    });

    if (!appointment) {
      throw new BadRequestException(
        new StandardResponse(true, 'APPOINTMENT_NOT_FOUND_FOR_DOCTOR'),
      );
    }

    // FIXED: Don't spread payload if it causes issues, explicitly create the object
    const prescription = this.prescriptionRepository.create({
      appointmentId: payload.appointmentId, // Explicit
      patientId: payload.patientId, // Explicit
      doctorId: authenticatedUser.id,
      signatureUrl: signatureUrl,
      diagnosis: payload.diagnosis,
      notes: payload.notes, // Add notes field
      medications: payload.medications, // Add medications array
      prescribedDate: new Date(),
    });

    console.log('Prescription to save:', prescription);

    await this.prescriptionRepository.save(prescription);

    // Get saved prescription with relations
    const savedPrescription = await this.prescriptionRepository.findOne({
      where: { id: prescription.id },
      relations: ['patient', 'doctor'],
    });

    // Email content - FIXED to use appointment.doctor and appointment.patient
    const emailContent = {
      prescriptionDate: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      doctorName:
        (appointment.doctor?.firstName || '') +
        ' ' +
        (appointment.doctor?.lastName || ''),
      doctorSpecialization:
        appointment.doctor?.professionDetails?.specialty || 'General',
      doctorContact:
        appointment.doctor?.email || appointment.doctor?.mobile || '',
      signatureUrl: savedPrescription.signatureUrl,
      prescriptionId: savedPrescription.id,
      prescribedDate: new Date(
        savedPrescription.prescribedDate,
      ).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      patientName:
        (appointment.patient?.firstName || '') +
        ' ' +
        (appointment.patient?.lastName || ''),
      consultationId: savedPrescription.appointmentId,
      diagnosis: savedPrescription.diagnosis,
      medications: savedPrescription.medications.map((med, index) => ({
        name: med.name,
        dosage: med.dosage,
        frequency: med.frequency,
        duration: med.duration,
        instructions: med.instructions || 'Take as directed',
      })),
      medicationCount: savedPrescription.medications.length,
      currentYear: new Date().getFullYear(),
    };

    // Send email to patient
    if (appointment.patient?.email) {
      this.mailSenderService.sendMail({
        recipient: appointment.patient.email,
        subject: 'Consultation Summary and Prescription Details',
        content: emailContent,
        template: 'drugs-prescription',
        bcc: 'Bolaji2438@gmail.com',
      });
    }

    return new StandardResponse(
      false,
      'PRESCRIPTION_CREATED_SUCCESSFULLY',
      savedPrescription,
    );
  }
}

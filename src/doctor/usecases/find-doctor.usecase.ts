import { CommonService } from 'src/common/common.service';
import { StandardResponse } from 'src/common/module/standard-response';
import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { PushNotificationEvent } from 'src/users/events/push-notification.event';
import { NotificationCategory } from 'src/users/model/notification-category';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, QueryRunner, Repository } from 'typeorm';
import { Appointment } from '../models/appointment.entity';
import { ConsultationStatus } from '../models/enums/consultation-status.enum';
import { DayOfWeek } from '../models/enums/day-of-week.enum';
import { ConsultationType } from '../models/enums/consultation-type.enum';
import { ConsultationSchedule } from '../models/consultation-schedule.entity';
import { Users } from 'src/users/model/users.entity';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { ConsultationRequestEvent } from '../events/consultation-request.event';
import { WalletService } from 'src/wallet/services/wallet.service';
import { MobileSenderService } from 'src/user-otp/mobile-sender.service';
import { HealthAiTriageService } from '../services/health-ai-triage.service';
import { ApprovalStatus } from '../models/enums/approval-status.enum';

const CONSULTATION_COST = 4500;
const PENDING_CONSULTATION_TIMEOUT_MS = 5 * 60 * 1000;
const IMMEDIATE_CONSULTATION_DURATION_MINUTES = 30;
const LAGOS_TIME_ZONE = 'Africa/Lagos';
const MAX_IMMEDIATE_CONSULTATION_REQUESTS = 5;

@Injectable()
export class FindDoctorUseCase {
  private readonly logger = new Logger(FindDoctorUseCase.name);

  constructor(
    private readonly commonService: CommonService,
    private readonly eventBus: EventBus,
    @InjectRepository(Appointment)
    private readonly appointmentRepo: Repository<Appointment>,
    @InjectRepository(ConsultationSchedule)
    private readonly scheduleRepo: Repository<ConsultationSchedule>,
    @InjectRepository(Users)
    private readonly userRepo: Repository<Users>,
    private readonly walletService: WalletService,
    private readonly mobileSenderService: MobileSenderService,
    private readonly healthAiTriageService: HealthAiTriageService,
    private readonly dataSource: DataSource,
  ) {}

  private async acquirePatientRoutingLock(
    patientId: string,
  ): Promise<QueryRunner> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      const [result] = await queryRunner.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        [`health-ai-routing:${patientId}`],
      );
      if (result?.acquired !== true) {
        throw new ConflictException(
          new StandardResponse(true, 'CONSULTATION_REQUEST_IN_PROGRESS'),
        );
      }
      return queryRunner;
    } catch (error) {
      await queryRunner.release();
      throw error;
    }
  }

  private async releasePatientRoutingLock(
    queryRunner: QueryRunner,
    patientId: string,
  ): Promise<void> {
    try {
      await queryRunner.query('SELECT pg_advisory_unlock(hashtext($1))', [
        `health-ai-routing:${patientId}`,
      ]);
    } finally {
      await queryRunner.release();
    }
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

  private async expireStalePendingForUser(patientId: string) {
    const now = new Date();
    const cutoff = new Date(Date.now() - PENDING_CONSULTATION_TIMEOUT_MS);
    const staleAppointments = await this.appointmentRepo.find({
      where: [
        {
          patientId,
          status: ConsultationStatus.PENDING_ACCEPTANCE,
          expiresAt: LessThan(now),
        },
        {
          patientId,
          status: ConsultationStatus.PENDING_ACCEPTANCE,
          createdAt: LessThan(cutoff),
        },
      ],
    });

    if (!staleAppointments.length) return;

    staleAppointments.forEach((appointment) => {
      appointment.status = ConsultationStatus.EXPIRED;
      appointment.expiresAt = this.getPendingExpiresAt(appointment);
    });

    await this.appointmentRepo.save(staleAppointments);
  }

  private buildActiveConsultationPayload(appointment: Appointment) {
    const doctor = appointment.doctor;
    const patient = appointment.patient;

    return {
      appointmentId: appointment.id,
      status: appointment.status,
      locked: [
        ConsultationStatus.PENDING_ACCEPTANCE,
        ConsultationStatus.ACTIVE,
      ].includes(appointment.status),
      role: 'patient',
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      doctorName: doctor
        ? `Dr. ${doctor.firstName} ${doctor.lastName}`.trim()
        : appointment.doctorName,
      patientName: patient
        ? `${patient.firstName} ${patient.lastName}`.trim()
        : appointment.patientName,
      consultationType: appointment.consultationType,
      consultationFee: Number(appointment.consultationAmount || 0),
      meetingLink: appointment.patientMeetingLink || appointment.meetingLink,
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
    };
  }

  private async assertNoActiveConsultation(patientId: string) {
    await this.expireStalePendingForUser(patientId);

    const activeAppointment = await this.appointmentRepo.findOne({
      where: {
        patientId,
        status: In([
          ConsultationStatus.PENDING_ACCEPTANCE,
          ConsultationStatus.ACTIVE,
        ]),
      },
      relations: ['doctor', 'patient'],
      order: { createdAt: 'DESC' },
    });

    if (activeAppointment) {
      throw new BadRequestException(
        new StandardResponse(
          true,
          'ACTIVE_CONSULTATION_EXISTS',
          this.buildActiveConsultationPayload(activeAppointment),
        ),
      );
    }
  }

  async execute(symptoms: string) {
    let routingLock: QueryRunner | undefined;
    let lockedPatientId: string | undefined;
    try {
      // 1. Get logged in user (patient)
      const loggedInUser = await this.commonService.getLoggedInUser();

      // 2. Validate symptoms before any wallet or model work.
      if (!symptoms || symptoms.trim() === '') {
        throw new BadRequestException('Symptoms are required');
      }

      // 3. The model only classifies the symptoms. Doctor eligibility and all
      // business decisions remain server-authoritative and provider-neutral.
      const analysis = await this.healthAiTriageService.analyze(symptoms);

      if (analysis.urgency === 'emergency') {
        return new StandardResponse(true, 'EMERGENCY_CARE_RECOMMENDED', {
          analysis,
          emergencyNumber: '112',
          message:
            'These symptoms may need emergency care. Call 112 or go to the nearest emergency department now.',
        });
      }

      // Wallet state must never prevent emergency guidance from being shown.
      const userWallet = await this.walletService.getWallet(loggedInUser.id);
      if (!userWallet) {
        throw new NotFoundException(
          new StandardResponse(true, 'USER_WALLET_NOT_INITIALIZED'),
        );
      }

      // Serialize the authoritative check-and-create section across PM2
      // workers. Checking after emergency classification ensures an existing
      // teleconsultation never masks advice to seek immediate emergency care.
      routingLock = await this.acquirePatientRoutingLock(loggedInUser.id);
      lockedPatientId = loggedInUser.id;
      await this.assertNoActiveConsultation(loggedInUser.id);

      // 4. Select available local doctors for the classified consultation type.
      const consultationRequests = [];
      const patientFullName = `${loggedInUser.firstName} ${loggedInUser.lastName}`;

      const localDoctorQuery = this.userRepo
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.professionDetails', 'professionDetails')
        .where('user.userRole = :doctorRole', { doctorRole: UserRoles.DOCTOR })
        .andWhere('professionDetails.isAvailable = :isAvailable', {
          isAvailable: true,
        })
        .andWhere('professionDetails.approvalStatus = :approvalStatus', {
          approvalStatus: ApprovalStatus.APPROVED,
        });

      const allAvailableDoctorUsers = await localDoctorQuery.getMany();
      // The consultation schedule is the authoritative capability record;
      // profile specialty remains display metadata and may contain free text.
      const localDoctorUsers = allAvailableDoctorUsers;

      const recommendedDoctors = localDoctorUsers.map((doctor) => ({
        id: doctor.id,
        name: `${doctor.firstName || ''} ${doctor.lastName || ''}`.trim(),
        specialty:
          this.normalizeConsultationType(doctor.professionDetails?.specialty) ||
          ConsultationType.GENERAL_PRACTITIONER,
        consultationType:
          this.normalizeConsultationType(doctor.professionDetails?.specialty) ||
          ConsultationType.GENERAL_PRACTITIONER,
        consultation_fee: Number(
          doctor.professionDetails?.consultationFee ?? CONSULTATION_COST,
        ),
        years_experience: doctor.professionDetails?.yearOfExperience,
        hospital: doctor.professionDetails?.medicalInstitution,
        phone: doctor.mobile,
        mobile: doctor.mobile,
        email: doctor.email,
        bio: doctor.professionDetails?.professionalBio,
      }));

      if (!recommendedDoctors.length) {
        return new StandardResponse(true, 'NO_LOCAL_DOCTORS_FOUND', {
          analysis,
          recommended_doctors: [],
          total_found: 0,
          consultation_requests: [],
          local_doctor_ids: [],
          local_doctor_count: 0,
          message:
            'No available local doctors match the recommended consultation type.',
        });
      }

      const localDoctorIdSet = new Set(localDoctorUsers.map((d) => d.id));
      const localDoctorEmailSet = new Set(
        localDoctorUsers.map((d) => d.email?.toLowerCase()).filter(Boolean),
      );
      const localDoctorPhoneSet = new Set(
        localDoctorUsers.map((d) => d.mobile).filter(Boolean),
      );
      const localDoctorById = new Map(
        localDoctorUsers.map((user) => [user.id, user]),
      );
      const scheduleContext = this.getCurrentLagosScheduleContext();
      const localDoctorSchedules = localDoctorUsers.length
        ? await this.scheduleRepo.find({
            where: {
              doctorId: In(localDoctorUsers.map((user) => user.id)),
              day: scheduleContext.day,
              isDayOff: false,
            },
          })
        : [];
      const activeSchedulesByDoctorId = new Map<
        string,
        ConsultationSchedule[]
      >();

      for (const schedule of localDoctorSchedules) {
        if (
          !this.isScheduleActiveForImmediateRequest(
            schedule,
            scheduleContext.minutes,
          )
        ) {
          continue;
        }

        const existingSchedules =
          activeSchedulesByDoctorId.get(schedule.doctorId) || [];
        existingSchedules.push(schedule);
        activeSchedulesByDoctorId.set(schedule.doctorId, existingSchedules);
      }

      const getLocalDoctorForRecommendation = (doctor: any) => {
        const doctorPhone = (doctor.phone || doctor.mobile || '').trim();
        return (
          localDoctorById.get(doctor.id) ||
          localDoctorUsers.find((user) => {
            const matchesByEmail = Boolean(
              doctor.email &&
              user.email &&
              user.email.toLowerCase() === doctor.email.toLowerCase(),
            );
            const matchesByPhone = Boolean(
              doctorPhone && user.mobile === doctorPhone,
            );
            return matchesByEmail || matchesByPhone;
          })
        );
      };

      const getDoctorConsultationFee = (doctor: any) => {
        const localDoctor = getLocalDoctorForRecommendation(doctor);
        return Number(
          localDoctor?.professionDetails?.consultationFee ??
            doctor.consultation_fee ??
            CONSULTATION_COST,
        );
      };

      const getDoctorConsultationType = (
        doctor: any,
      ): ConsultationType | null => {
        const localDoctor = getLocalDoctorForRecommendation(doctor);
        return (
          this.normalizeConsultationType(doctor.specialty) ||
          this.normalizeConsultationType(doctor.consultationType) ||
          this.normalizeConsultationType(
            localDoctor?.professionDetails?.specialty,
          )
        );
      };

      const getActiveScheduleForDoctor = (
        doctor: any,
        requiredType?: ConsultationType,
      ): ConsultationSchedule | undefined => {
        const localDoctor = getLocalDoctorForRecommendation(doctor);
        if (!localDoctor) return undefined;

        const doctorSchedules =
          activeSchedulesByDoctorId.get(localDoctor.id) || [];
        if (!doctorSchedules.length) return undefined;

        const consultationType =
          requiredType || getDoctorConsultationType(doctor);
        if (!consultationType) return doctorSchedules[0];

        return doctorSchedules.find(
          (schedule) => schedule.consultationType === consultationType,
        );
      };

      const scheduledSpecialists = recommendedDoctors.filter((doctor) => {
        const doctorPhone = (doctor.phone || doctor.mobile || '').trim();
        const matchesById = localDoctorIdSet.has(doctor.id);
        const matchesByEmail = Boolean(
          doctor.email && localDoctorEmailSet.has(doctor.email.toLowerCase()),
        );
        const matchesByPhone = Boolean(
          doctorPhone && localDoctorPhoneSet.has(doctorPhone),
        );
        const isLocalDoctor = matchesById || matchesByEmail || matchesByPhone;
        return (
          isLocalDoctor &&
          Boolean(getActiveScheduleForDoctor(doctor, analysis.consultationType))
        );
      });
      // A GP is the safe fallback only when nobody with the requested active
      // consultation schedule is available.
      const selectedConsultationType = scheduledSpecialists.length
        ? analysis.consultationType
        : ConsultationType.GENERAL_PRACTITIONER;
      const filteredDoctors = scheduledSpecialists.length
        ? scheduledSpecialists
        : recommendedDoctors.filter((doctor) =>
            Boolean(
              getActiveScheduleForDoctor(
                doctor,
                ConsultationType.GENERAL_PRACTITIONER,
              ),
            ),
          );

      if (!filteredDoctors.length) {
        return new StandardResponse(true, 'NO_LOCAL_DOCTORS_FOUND', {
          analysis,
          recommended_doctors: recommendedDoctors,
          total_found: recommendedDoctors.length,
          consultation_requests: [],
          local_doctor_ids: localDoctorUsers.map((user) => user.id),
          local_doctor_count: localDoctorUsers.length,
          requested_day: scheduleContext.day,
          requested_time: scheduleContext.time,
          message:
            'No matching doctors are currently within their availability schedule.',
        });
      }

      const allAffordableDoctors = filteredDoctors.filter(
        (doctor) =>
          Number(userWallet.walletBalance) >= getDoctorConsultationFee(doctor),
      );

      if (!allAffordableDoctors.length) {
        const minimumConsultationFee = Math.min(
          ...filteredDoctors.map((doctor) => getDoctorConsultationFee(doctor)),
        );

        throw new BadRequestException(
          new StandardResponse(true, 'INSUFFICIENT_BALANCE', {
            walletBalance: Number(userWallet.walletBalance || 0),
            minimumConsultationFee,
          }),
        );
      }

      // Avoid notification storms and unnecessary appointment rows while
      // still giving the patient several doctors who can accept first.
      const affordableDoctors = allAffordableDoctors.slice(
        0,
        MAX_IMMEDIATE_CONSULTATION_REQUESTS,
      );

      for (const doctor of affordableDoctors) {
        const localDoctor = getLocalDoctorForRecommendation(doctor);
        const activeSchedule = getActiveScheduleForDoctor(
          doctor,
          selectedConsultationType,
        );
        const doctorId = localDoctor?.id || doctor.id;
        const doctorName =
          doctor.name ||
          `${localDoctor?.firstName || ''} ${localDoctor?.lastName || ''}`.trim();
        const doctorEmail = doctor.email || localDoctor?.email;
        const doctorPhone =
          doctor.phone || doctor.mobile || localDoctor?.mobile;
        const roomId = `consult_${doctorId}_${loggedInUser.id}_${Date.now()}`;
        const meetingLink = `https://jitsi.cushyaccess.com/${roomId}`;
        const consultationFee = getDoctorConsultationFee(doctor);
        const consultationType =
          activeSchedule?.consultationType ||
          getDoctorConsultationType(doctor) ||
          ConsultationType.GENERAL_PRACTITIONER;

        const appointment = this.appointmentRepo.create({
          doctorId,
          patientId: loggedInUser.id,
          consultationType,
          day: scheduleContext.day,
          date: scheduleContext.date,
          startTime: scheduleContext.time,
          endTime: this.addMinutesToTime(
            scheduleContext.time,
            IMMEDIATE_CONSULTATION_DURATION_MINUTES,
          ),
          consultationAmount: consultationFee,
          status: ConsultationStatus.PENDING_ACCEPTANCE,
          expiresAt: new Date(Date.now() + PENDING_CONSULTATION_TIMEOUT_MS),
          meetingLink,
          doctorMeetingLink: `${meetingLink}?userType=doctor`,
          patientMeetingLink: `${meetingLink}?userType=patient`,
          roomName: roomId,
          meetingProvider: 'jitsi',
          doctorName,
          patientName: patientFullName,
        });

        const savedAppointment = await this.appointmentRepo.save(appointment);

        if (routingLock && lockedPatientId) {
          await this.releasePatientRoutingLock(routingLock, lockedPatientId);
          routingLock = undefined;
          lockedPatientId = undefined;
        }

        const additionalInfo = JSON.stringify({
          type: 'IMMEDIATE_CONSULTATION_REQUEST',
          appointmentId: savedAppointment.id,
          patientId: loggedInUser.id,
          patientName: patientFullName,
          patientEmail: loggedInUser.email,
          patientPhone: loggedInUser.mobile,
          symptoms,
          consultationType,
          specialty: analysis.specialty || 'General Practitioner',
          urgency: analysis.urgency || 'medium',
          confidence: analysis.confidence || 0.7,
          reasoning: analysis.reasoning || '',
          consultationFee,
          doctorId,
          doctorName,
          doctorSpecialty: consultationType,
          doctorEmail,
          doctorPhone,
          roomId,
          meetingLink,
          doctorMeetingLink: `${meetingLink}?userType=doctor`,
          patientMeetingLink: `${meetingLink}?userType=patient`,
          action: 'accept_reject',
          requiresImmediateAction: true,
        });

        const deepLink = `cushyaccess://consultation-request/${savedAppointment.id}?doctorId=${doctorId}&roomId=${roomId}&patientId=${loggedInUser.id}&action=accept_reject`;

        // Push notification to doctor
        this.eventBus.publish(
          new PushNotificationEvent(
            doctorId,
            NotificationCategory.IMMEDIATE_CONSULTATION_REQUEST,
            additionalInfo,
            'consultation_alert.wav',
            deepLink,
          ),
        );

        // SMS notification to doctor
        if (doctorPhone) {
          try {
            await this.mobileSenderService.sendConsultationRequestSms(
              doctorPhone,
              {
                doctorName,
                doctorCallingCode: localDoctor?.callingCode,
                patientName: patientFullName,
                symptoms,
                appointmentId: savedAppointment.id,
              },
            );
          } catch (error) {
            this.logger.warn(
              `Consultation SMS failed for appointment ${savedAppointment.id}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }

        this.eventBus.publish(
          new ConsultationRequestEvent(doctorId, {
            appointmentId: savedAppointment.id,
            patientId: loggedInUser.id,
            patientName: patientFullName,
            patientEmail: loggedInUser.email,
            patientPhone: loggedInUser.mobile,
            symptoms,
            specialty: analysis.specialty || 'General Practitioner',
            urgency: analysis.urgency || 'medium',
            confidence: analysis.confidence || 0.7,
            reasoning: analysis.reasoning || '',
            consultationFee,
            consultationType,
            roomId,
            meetingLink,
            doctorMeetingLink: `${meetingLink}?userType=doctor`,
            patientMeetingLink: `${meetingLink}?userType=patient`,
            requestedAt: new Date().toISOString(),
          }),
        );

        const doctorInfo = localDoctor;
        const doctorPatientsCount = await this.appointmentRepo.count({
          where: { doctorId, status: ConsultationStatus.COMPLETED },
        });

        consultationRequests.push({
          doctorId,
          doctorName,
          doctorSpecialty: consultationType,
          doctorEmail,
          doctorPhone,
          appointmentId: savedAppointment.id,
          status: ConsultationStatus.PENDING_ACCEPTANCE,
          consultationFee,
          roomId,
          meetingLink,
          patientName: patientFullName,
          patientEmail: loggedInUser.email,
          symptoms,
          analysis,
          doctorProfilePicture: doctorInfo?.profilePic || null,
          yearsOfExperience:
            doctorInfo?.professionDetails?.yearOfExperience || null,
          patientsServed: doctorPatientsCount,
        });
      }

      // 5. Return response
      return new StandardResponse(false, 'DOCTOR_FOUND_SUCCESSFULLY', {
        analysis,
        recommended_doctors: affordableDoctors.map((doctor) => ({
          id: getLocalDoctorForRecommendation(doctor)?.id || doctor.id,
          name: doctor.name,
          specialty:
            getActiveScheduleForDoctor(doctor, selectedConsultationType)
              ?.consultationType ||
            getDoctorConsultationType(doctor) ||
            doctor.specialty,
          consultation_fee: getDoctorConsultationFee(doctor),
          years_experience: doctor.years_experience,
          hospital: doctor.hospital,
          phone:
            doctor.phone ||
            doctor.mobile ||
            getLocalDoctorForRecommendation(doctor)?.mobile,
          email: doctor.email || getLocalDoctorForRecommendation(doctor)?.email,
          bio: doctor.bio,
        })),
        total_found: affordableDoctors.length,
        consultation_requests: consultationRequests,
        message: `Consultation requests sent to ${affordableDoctors.length} local doctor(s). Waiting for doctor to accept.`,
      });
    } finally {
      if (routingLock && lockedPatientId) {
        await this.releasePatientRoutingLock(routingLock, lockedPatientId);
      }
    }
  }

  private getCurrentLagosScheduleContext(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: LAGOS_TIME_ZONE,
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);

    const getPart = (type: string) =>
      parts.find((part) => part.type === type)?.value || '';
    const hour = getPart('hour') === '24' ? '00' : getPart('hour');
    const minute = getPart('minute') || '00';

    return {
      day: (getPart('weekday') || '').toUpperCase() as DayOfWeek,
      date: `${getPart('year')}-${getPart('month')}-${getPart('day')}`,
      time: `${hour}:${minute}:00`,
      minutes: Number(hour) * 60 + Number(minute),
    };
  }

  private scheduleTimeToMinutes(time?: string | null): number | null {
    if (!time) return null;

    const normalized = time.trim();
    const twelveHourMatch = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(
      normalized,
    );
    if (twelveHourMatch) {
      let hour = Number(twelveHourMatch[1]);
      const minute = Number(twelveHourMatch[2] || 0);
      const period = twelveHourMatch[3].toUpperCase();

      if (period === 'AM') {
        hour = hour === 12 ? 0 : hour;
      } else {
        hour = hour === 12 ? 12 : hour + 12;
      }

      return hour * 60 + minute;
    }

    const twentyFourHourMatch = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?$/.exec(
      normalized,
    );
    if (!twentyFourHourMatch) return null;

    const hour = Number(twentyFourHourMatch[1]);
    const minute = Number(twentyFourHourMatch[2] || 0);
    if (
      Number.isNaN(hour) ||
      Number.isNaN(minute) ||
      hour > 23 ||
      minute > 59
    ) {
      return null;
    }

    return hour * 60 + minute;
  }

  private isScheduleActiveForImmediateRequest(
    schedule: ConsultationSchedule,
    currentMinutes: number,
  ) {
    const openMinutes = this.scheduleTimeToMinutes(schedule.openTime);
    const closeMinutes = this.scheduleTimeToMinutes(schedule.closeTime);

    if (openMinutes === null || closeMinutes === null) return false;
    if (openMinutes === closeMinutes) return false;

    const requestEndMinutes =
      currentMinutes + IMMEDIATE_CONSULTATION_DURATION_MINUTES;

    if (openMinutes < closeMinutes) {
      return currentMinutes >= openMinutes && requestEndMinutes <= closeMinutes;
    }

    const normalizedStartMinutes =
      currentMinutes < openMinutes ? currentMinutes + 24 * 60 : currentMinutes;
    const normalizedCloseMinutes = closeMinutes + 24 * 60;

    return (
      normalizedStartMinutes >= openMinutes &&
      normalizedStartMinutes + IMMEDIATE_CONSULTATION_DURATION_MINUTES <=
        normalizedCloseMinutes
    );
  }

  private normalizeConsultationType(
    value?: string | null,
  ): ConsultationType | null {
    if (!value) return null;

    const normalized = value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const aliases: Record<string, ConsultationType> = {
      GENERAL: ConsultationType.GENERAL_PRACTITIONER,
      GP: ConsultationType.GENERAL_PRACTITIONER,
      GENERAL_PRACTIONER: ConsultationType.GENERAL_PRACTITIONER,
      GENERAL_PRACTITIONER: ConsultationType.GENERAL_PRACTITIONER,
      PSYCHIATRIC: ConsultationType.PSYCHIATRIST,
      PSYCHIATRIST: ConsultationType.PSYCHIATRIST,
      ENT: ConsultationType.ENT_SPECIALIST,
      E_N_T: ConsultationType.ENT_SPECIALIST,
    };

    if (aliases[normalized]) return aliases[normalized];

    return Object.values(ConsultationType).includes(
      normalized as ConsultationType,
    )
      ? (normalized as ConsultationType)
      : null;
  }

  private addMinutesToTime(time: string, minutesToAdd: number) {
    const minutes = this.scheduleTimeToMinutes(time);
    if (minutes === null) return time;

    const updatedMinutes = (minutes + minutesToAdd) % (24 * 60);
    const hour = Math.floor(updatedMinutes / 60);
    const minute = updatedMinutes % 60;

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  }

  async enrichDoctorsWithProfilePictures(doctors: any[]): Promise<any[]> {
    if (!doctors || doctors.length === 0) return [];

    const doctorIds = doctors.map((doctor) => doctor.id);
    const doctorUsers = await this.userRepo.find({
      where: {
        id: In(doctorIds),
        professionDetails: {
          isAvailable: true,
        },
      },
      relations: ['professionDetails'],
    });

    const doctorUserMap = new Map(doctorUsers.map((user) => [user.id, user]));

    const availableDoctors = doctors.filter((doctor) =>
      doctorUserMap.has(doctor.id),
    );

    const patientsServedCounts = await Promise.all(
      availableDoctors.map((doctor) =>
        this.appointmentRepo.count({
          where: { doctorId: doctor.id, status: ConsultationStatus.COMPLETED },
        }),
      ),
    );

    return availableDoctors.map((doctor, index) => {
      const doctorUser = doctorUserMap.get(doctor.id);
      return {
        id: doctor.id,
        name: doctor.name,
        specialty: doctor.specialty,
        consultation_fee: doctor.consultation_fee,
        years_experience:
          doctorUser?.professionDetails?.yearOfExperience ||
          doctor.years_experience,
        hospital: doctor.hospital,
        phone: doctor.phone,
        email: doctor.email,
        bio: doctor.bio,
        profile_picture: doctorUser?.profilePic || null,
        patients_served: patientsServedCounts[index],
      };
    });
  }
}

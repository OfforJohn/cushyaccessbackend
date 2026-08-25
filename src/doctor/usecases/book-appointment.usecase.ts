import { Repository, DataSource } from 'typeorm';
import { ConsultationSchedule } from '../models/consultation-schedule.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Appointment } from '../models/appointment.entity';
import { Users } from 'src/users/model/users.entity';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { StandardResponse } from 'src/common/module/standard-response';
import { CommonService } from 'src/common/common.service';
import { BookAppointmentDto } from '../DTO/book-appointment.dto';
import { WalletService } from 'src/wallet/services/wallet.service';
import { ConsultationStatus } from '../models/enums/consultation-status.enum';
import { EventBus } from '@nestjs/cqrs';
import { PushNotificationEvent } from 'src/users/events/push-notification.event';
import { NotificationCategory } from 'src/users/model/notification-category';
import { MailSenderService } from 'src/user-otp/mail-sender.service';
import { MobileSenderService } from 'src/user-otp/mobile-sender.service';
import { AppointmentReminderService } from '../appointment-reminder.service';
import { DayOfWeek } from '../models/enums/day-of-week.enum';
import { EightEightTokenService } from 'src/utils/8x8-token.service';
import { GetAvailableSlotsDto } from '../DTO/get-available-slots.dto';

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(h, m + minutes, 0, 0);
  return date.toTimeString().slice(0, 5);
}

function calculateAppointmentDate(
  dayOfWeek: DayOfWeek,
  startTime: string,
): string {
  const daysMap = {
    [DayOfWeek.SUNDAY]: 0,
    [DayOfWeek.MONDAY]: 1,
    [DayOfWeek.TUESDAY]: 2,
    [DayOfWeek.WEDNESDAY]: 3,
    [DayOfWeek.THURSDAY]: 4,
    [DayOfWeek.FRIDAY]: 5,
    [DayOfWeek.SATURDAY]: 6,
  };

  const targetDayIndex = daysMap[dayOfWeek];
  const today = new Date();
  const currentDayIndex = today.getDay();

  let daysToAdd = targetDayIndex - currentDayIndex;

  if (daysToAdd < 0) {
    daysToAdd += 7;
  }

  if (daysToAdd === 0) {
    const [targetHour, targetMinute] = startTime.split(':').map(Number);
    const currentHour = today.getHours();
    const currentMinute = today.getMinutes();

    if (
      currentHour > targetHour ||
      (currentHour === targetHour && currentMinute >= targetMinute)
    ) {
      daysToAdd = 7;
    }
  }

  const appointmentDate = new Date(today);
  appointmentDate.setDate(today.getDate() + daysToAdd);

  return appointmentDate.toISOString().split('T')[0];
}

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

// Helper to generate unique room ID
function generateRoomId(doctorId: string, patientId: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `consult_${doctorId}_${patientId}_${timestamp}_${random}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
}

@Injectable()
export class AppointmentUseCase {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepo: Repository<Appointment>,

    @InjectRepository(ConsultationSchedule)
    private readonly scheduleRepo: Repository<ConsultationSchedule>,

    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,

    private readonly commonService: CommonService,
    private readonly walletService: WalletService,
    private readonly dataSource: DataSource,
    private readonly eventBus: EventBus,
    private readonly mailSenderService: MailSenderService,
    private readonly mobileSenderService: MobileSenderService,
    private readonly appointmentReminderService: AppointmentReminderService,
    private readonly eightEightTokenService: EightEightTokenService,
  ) {}

  async execute(dto: BookAppointmentDto) {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const { doctorId, consultationType, day, selectedDate, selectedTime } = dto;

    const doctor = await this.usersRepo.findOne({
      where: { id: doctorId, userRole: UserRoles.DOCTOR },
      relations: ['professionDetails'],
    });

    if (!doctor) {
      return new StandardResponse(true, 'DOCTOR_NOT_FOUND');
    }

    if (!doctor.professionDetails?.isAvailable) {
      return new StandardResponse(true, 'DOCTOR_NOT_AVAILABLE');
    }

    const consultationFee = Number(
      doctor.professionDetails?.consultationFee ?? 0,
    );

    // Determine which day to use (selectedDate takes priority)
    let targetDay = day;
    const targetDate = selectedDate;
    const targetTime = selectedTime;

    if (selectedDate && selectedTime) {
      // User selected specific date and time
      const selectedDateObj = new Date(selectedDate);
      targetDay = this.getDayOfWeekEnum(selectedDateObj.getDay());

      // Verify the slot is still available
      const schedules = await this.scheduleRepo.find({
        where: {
          doctorId,
          consultationType,
          isDayOff: false,
        },
      });

      const availableSlots = await this.getAvailableSlotsForDate(
        doctorId,
        consultationType,
        selectedDate,
        schedules,
      );

      const slotAvailable = availableSlots.some(
        (slot) => slot.startTime === selectedTime,
      );

      if (!slotAvailable) {
        throw new BadRequestException(
          new StandardResponse(true, 'SELECTED_TIME_SLOT_NOT_AVAILABLE'),
        );
      }
    }

    // If no selectedDate/selectedTime, use original logic (find first available)
    let schedule;
    let assignedStart: string | null = null;
    let assignedEnd: string | null = null;
    let appointmentDate: string;

    if (targetDate && targetTime) {
      // Use user-selected date and time
      schedule = await this.scheduleRepo.findOne({
        where: {
          doctorId,
          consultationType,
          day: targetDay,
          isDayOff: false,
        },
      });

      if (!schedule) {
        return new StandardResponse(true, 'DOCTOR_NOT_AVAILABLE_ON_THIS_DAY');
      }

      assignedStart = targetTime;
      assignedEnd = addMinutes(targetTime, 30);
      appointmentDate = targetDate;

      // Verify within working hours
      if (
        assignedStart < schedule.openTime ||
        assignedEnd > schedule.closeTime
      ) {
        throw new BadRequestException(
          new StandardResponse(true, 'SELECTED_TIME_OUTSIDE_WORKING_HOURS'),
        );
      }
    } else {
      // Original logic: find first available slot
      schedule = await this.scheduleRepo.findOne({
        where: {
          doctorId,
          consultationType,
          day,
          isDayOff: false,
        },
      });

      if (!schedule) {
        return new StandardResponse(true, 'DOCTOR_NOT_AVAILABLE');
      }

      return await this.dataSource.transaction(async (manager) => {
        const bookedAppointments = await manager
          .createQueryBuilder(Appointment, 'a')
          .setLock('pessimistic_write')
          .where('a.doctorId = :doctorId', { doctorId })
          .andWhere('a.day = :day', { day })
          .andWhere('a.status = :status', { status: ConsultationStatus.BOOKED })
          .orderBy('a.startTime', 'ASC')
          .getMany();

        let currentTime = schedule.openTime;
        let assignedStart: string | null = null;
        let assignedEnd: string | null = null;

        while (addMinutes(currentTime, 30) <= schedule.closeTime) {
          const slotEnd = addMinutes(currentTime, 30);

          const isTaken = bookedAppointments.some(
            (a) => currentTime < a.endTime && slotEnd > a.startTime,
          );

          if (!isTaken) {
            assignedStart = currentTime;
            assignedEnd = slotEnd;
            break;
          }

          currentTime = slotEnd;
        }

        if (!assignedStart || !assignedEnd) {
          throw new BadRequestException(
            new StandardResponse(true, 'NO_AVAILABLE_TIME_SLOT'),
          );
        }

        appointmentDate = calculateAppointmentDate(day, assignedStart);

        // Continue with appointment creation...
        return await this.createAppointment(
          manager,
          authenticatedUser,
          doctor,
          schedule,
          assignedStart,
          assignedEnd,
          appointmentDate,
          day,
          consultationFee,
          consultationType,
        );
      });
    }

    // For user-selected date/time flow
    return await this.dataSource.transaction(async (manager) => {
      // Double-check slot not taken (pessimistic lock)
      const existingAppointment = await manager
        .createQueryBuilder(Appointment, 'a')
        .setLock('pessimistic_write')
        .where('a.doctorId = :doctorId', { doctorId })
        .andWhere('a.date = :date', { date: appointmentDate })
        .andWhere('a.startTime = :startTime', { startTime: assignedStart })
        .andWhere('a.status = :status', { status: ConsultationStatus.BOOKED })
        .getOne();

      if (existingAppointment) {
        throw new BadRequestException(
          new StandardResponse(true, 'TIME_SLOT_JUST_BOOKED'),
        );
      }

      // Verify wallet funding; actual deduction happens only when a doctor accepts.
      if (consultationFee > 0) {
        const wallet = await this.walletService.getWallet(authenticatedUser.id);

        if (!wallet) {
          throw new NotFoundException(
            new StandardResponse(true, 'USER_WALLET_NOT_INITIALIZED'),
          );
        }

        if (wallet.walletBalance < consultationFee) {
          throw new BadRequestException(
            new StandardResponse(true, 'INSUFFICIENT_BALANCE_FOR_CONSULTATION'),
          );
        }
      }

      return await this.createAppointment(
        manager,
        authenticatedUser,
        doctor,
        schedule,
        assignedStart,
        assignedEnd,
        appointmentDate,
        targetDay,
        consultationFee,
        consultationType,
      );
    });
  }

  // NEW HELPER: Create appointment (extracted from original logic to avoid duplication)
  private async createAppointment(
    manager: any,
    authenticatedUser: Users,
    doctor: Users,
    schedule: ConsultationSchedule,
    startTime: string,
    endTime: string,
    appointmentDate: string,
    day: DayOfWeek,
    consultationFee: number,
    consultationType: string,
  ) {
    // Create appointment first to get ID
    const appointment = manager.create(Appointment, {
      doctorId: doctor.id,
      patientId: authenticatedUser.id,
      consultationType,
      consultationAmount: consultationFee,
      date: appointmentDate,
      day,
      startTime,
      endTime,
      meetingLink: '', // Will be updated after generating
      status: ConsultationStatus.BOOKED,
    });

    const savedAppointment = await manager.save(appointment);

    // Generate meeting details
    const roomId = generateRoomId(doctor.id, authenticatedUser.id);
    const meetingLink = `https://jitsi.cushyaccess.com/${roomId}`;

    savedAppointment.meetingLink = meetingLink;
    savedAppointment.roomName = roomId;

    // Generate separate links for doctor and patient if needed
    savedAppointment.doctorMeetingLink = `${meetingLink}?userType=doctor`;
    savedAppointment.patientMeetingLink = `${meetingLink}?userType=patient`;

    await manager.save(Appointment, savedAppointment);

    await this.sendAppointmentNotifications(
      authenticatedUser,
      doctor,
      savedAppointment,
      consultationFee,
    );

    // Schedule reminders
    await this.appointmentReminderService.scheduleReminders(
      savedAppointment.id,
      authenticatedUser.id,
      doctor.id,
    );

    const responseWithFormattedTimes = {
      ...savedAppointment,
      startTime: formatTimeTo12Hour(savedAppointment.startTime),
      endTime: formatTimeTo12Hour(savedAppointment.endTime),
      startTimeDisplay: formatTimeTo12HourDisplay(savedAppointment.startTime),
      endTimeDisplay: formatTimeTo12HourDisplay(savedAppointment.endTime),
      meetingDetails: {
        roomName: savedAppointment.roomName,
        meetingUrl: savedAppointment.meetingLink,
        doctorMeetingLink: savedAppointment.doctorMeetingLink,
        patientMeetingLink: savedAppointment.patientMeetingLink,
        instantJoin: true,
        noModeratorRequired: true,
      },
    };

    return new StandardResponse(
      false,
      'APPOINTMENT_BOOKED_SUCCESSFULLY',
      responseWithFormattedTimes,
    );
  }

  // NEW HELPER: Convert day number to DayOfWeek enum
  private getDayOfWeekEnum(dayNumber: number): DayOfWeek {
    const dayMap = {
      0: DayOfWeek.SUNDAY,
      1: DayOfWeek.MONDAY,
      2: DayOfWeek.TUESDAY,
      3: DayOfWeek.WEDNESDAY,
      4: DayOfWeek.THURSDAY,
      5: DayOfWeek.FRIDAY,
      6: DayOfWeek.SATURDAY,
    };
    return dayMap[dayNumber];
  }

  private async sendAppointmentNotifications(
    patient: Users,
    doctor: Users,
    appointment: Appointment,
    consultationFee: number,
  ) {
    try {
      const doctorNotificationMessage = `New appointment! ${patient.firstName} ${patient.lastName} has booked a consultation for ${appointment.day} at ${appointment.startTime}.`;

      this.eventBus.publish(
        new PushNotificationEvent(
          doctor.id,
          NotificationCategory.DOCTOR_NEW_APPOINTMENT,
          JSON.stringify({
            message: doctorNotificationMessage,
            appointmentId: appointment.id,
            patientId: patient.id,
            patientName: `${patient.firstName} ${patient.lastName}`,
            appointmentDate: appointment.date,
            appointmentTime: appointment.startTime,
            consultationType: appointment.consultationType,
          }),
        ),
      );

      await this.sendAppointmentSms(
        patient,
        doctor,
        appointment,
        consultationFee,
      );

      await this.sendAppointmentEmail(
        patient,
        doctor,
        appointment,
        consultationFee,
      );
    } catch (error) {
      console.error('Failed to send appointment notifications:', error);
    }
  }

  private async sendAppointmentSms(
    patient: Users,
    doctor: Users,
    appointment: Appointment,
    consultationFee: number,
  ) {
    try {
      if (this.mobileSenderService && patient.mobile) {
        await this.mobileSenderService.sendAppointmentSmsNotif(
          patient.mobile,
          doctor.mobile,
          {
            patientName: `${patient.firstName} ${patient.lastName}`,
            doctorName: `Dr. ${doctor.firstName} ${doctor.lastName}`,
            patientCallingCode: patient.callingCode,
            doctorCallingCode: doctor.callingCode,
            appointmentDay: appointment.day,
            appointmentDate: appointment.date,
            appointmentTime: appointment.startTime,
            consultationFee: consultationFee,
          },
        );
      }
    } catch (error) {
      console.error('Failed to send appointment SMS:', error);
    }
  }

  private async sendAppointmentEmail(
    patient: Users,
    doctor: Users,
    appointment: Appointment,
    consultationFee: number,
  ) {
    try {
      if (this.mailSenderService && patient.email) {
        const emailContent = {
          patientName: `${patient.firstName} ${patient.lastName}`,
          doctorName: `Dr. ${doctor.firstName} ${doctor.lastName}`,
          appointmentDay: appointment.day,
          appointmentTime: appointment.startTime,
          appointmentDate: appointment.date,
          consultationType: appointment.consultationType,
          consultationFee: consultationFee,
          meetingLink: appointment.meetingLink,
          doctorMeetingLink: appointment.doctorMeetingLink,
          patientMeetingLink: appointment.patientMeetingLink,
          roomName: appointment.roomName,
          duration: '30 minutes',
          instantJoin: true,
          currentYear: new Date().getFullYear(),
        };

        // Send to patient
        this.mailSenderService.sendMail({
          recipient: patient.email,
          subject: 'Appointment Confirmation - Cushy Access',
          content: emailContent,
          template: 'appointment-confirmation',
          bcc: ['ornagletransact@gmail.com', 'bolaji2438@gmail.com'],
        });

        // Send to doctor
        if (doctor.email) {
          this.mailSenderService.sendMail({
            recipient: doctor.email,
            subject: 'New Appointment Notification',
            content: {
              ...emailContent,
              patientName: `${patient.firstName} ${patient.lastName}`,
              patientPhone: patient.mobile,
            },
            template: 'doctor-appointment-notification',
          });
        }
      }
    } catch (error) {
      console.error('Failed to send appointment email:', error);
    }
  }
  async getAvailableSlots(dto: GetAvailableSlotsDto) {
    console.log('=== getAvailableSlots called ===');
    console.log('DTO:', JSON.stringify(dto, null, 2));

    const { doctorId, consultationType, selectedDate } = dto;

    const doctor = await this.usersRepo.findOne({
      where: { id: doctorId, userRole: UserRoles.DOCTOR },
      relations: ['professionDetails'],
    });

    if (!doctor) {
      console.log('Doctor not found');
      return new StandardResponse(true, 'DOCTOR_NOT_FOUND');
    }

    if (!doctor.professionDetails?.isAvailable) {
      console.log('Doctor is unavailable');
      return new StandardResponse(true, 'DOCTOR_NOT_AVAILABLE');
    }

    // Get all schedules for this doctor and consultation type
    const schedules = await this.scheduleRepo.find({
      where: {
        doctorId,
        consultationType,
        isDayOff: false,
      },
      order: {
        day: 'ASC',
      },
    });

    console.log('Schedules found:', schedules.length);
    console.log('Schedules:', JSON.stringify(schedules, null, 2));

    if (!schedules.length) {
      console.log('No schedules found');
      return new StandardResponse(true, 'DOCTOR_NOT_AVAILABLE');
    }

    // Generate available slots
    const availableSlots = [];

    if (selectedDate) {
      console.log('Getting slots for specific date:', selectedDate);
      // Get slots for specific date
      const slots = await this.getAvailableSlotsForDate(
        doctorId,
        consultationType,
        selectedDate,
        schedules,
      );

      console.log(`Found ${slots.length} slots for ${selectedDate}`);

      if (slots.length > 0) {
        availableSlots.push({
          date: selectedDate,
          dayOfWeek: this.getDayOfWeekString(new Date(selectedDate).getDay()),
          slots: slots,
        });
      }
    } else {
      console.log('Getting slots for next 7 days');
      // Get slots for next 7 days
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];

        console.log(`Checking date ${i + 1}: ${dateStr}`);

        const slots = await this.getAvailableSlotsForDate(
          doctorId,
          consultationType,
          dateStr,
          schedules,
        );

        console.log(`Found ${slots.length} slots for ${dateStr}`);

        if (slots.length > 0) {
          availableSlots.push({
            date: dateStr,
            dayOfWeek: this.getDayOfWeekString(date.getDay()),
            slots: slots,
          });
        }
      }
    }

    console.log(`Total available slots groups: ${availableSlots.length}`);

    return new StandardResponse(false, 'AVAILABLE_SLOTS_FETCHED', {
      doctorId,
      doctorName: `Dr. ${doctor.firstName} ${doctor.lastName}`,
      consultationFee: doctor.professionDetails?.consultationFee ?? 0,
      availableSlots,
    });
  }

  // NEW HELPER METHOD: Get available slots for a specific date
  private async getAvailableSlotsForDate(
    doctorId: string,
    consultationType: string,
    dateStr: string,
    schedules: ConsultationSchedule[],
  ): Promise<any[]> {
    console.log(`  => getAvailableSlotsForDate called with date: ${dateStr}`);

    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();

    console.log(`  => Day of week number: ${dayOfWeek}`);

    // Map day number to DayOfWeek enum
    const dayMap = {
      0: DayOfWeek.SUNDAY,
      1: DayOfWeek.MONDAY,
      2: DayOfWeek.TUESDAY,
      3: DayOfWeek.WEDNESDAY,
      4: DayOfWeek.THURSDAY,
      5: DayOfWeek.FRIDAY,
      6: DayOfWeek.SATURDAY,
    };

    const targetDay = dayMap[dayOfWeek];
    console.log(`  => Target day enum: ${targetDay}`);

    // Find schedule for this day
    const schedule = schedules.find((s) => s.day === targetDay);

    if (!schedule) {
      console.log(`  => No schedule found for ${targetDay}`);
      return [];
    }

    console.log(
      `  => Schedule found: openTime=${schedule.openTime}, closeTime=${schedule.closeTime}`,
    );

    // Check if date is in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const compareDate = new Date(dateStr);
    compareDate.setHours(0, 0, 0, 0);

    if (compareDate < today) {
      console.log(`  => Date ${dateStr} is in the past, returning empty`);
      return [];
    }

    // Get booked appointments for this date
    const bookedAppointments = await this.appointmentRepo
      .createQueryBuilder('a')
      .where('a.doctorId = :doctorId', { doctorId })
      .andWhere('a.date = :date', { date: dateStr })
      .andWhere('a.status IN (:...statuses)', {
        statuses: [
          ConsultationStatus.BOOKED,
          ConsultationStatus.ACKNOWLEDGED,
          ConsultationStatus.ACTIVE,
        ],
      })
      .getMany();

    console.log(`  => Booked appointments count: ${bookedAppointments.length}`);
    if (bookedAppointments.length > 0) {
      console.log(
        `  => Booked slots: ${bookedAppointments.map((a) => `${a.startTime}-${a.endTime}`).join(', ')}`,
      );
    }

    // Generate all possible time slots
    const allSlots = [];
    let currentTime = schedule.openTime;
    const slotDuration = 30; // minutes

    console.log(
      `  => Generating slots from ${currentTime} to ${schedule.closeTime}`,
    );

    while (addMinutes(currentTime, slotDuration) <= schedule.closeTime) {
      const slotEnd = addMinutes(currentTime, slotDuration);

      // Check if slot is taken
      const isTaken = bookedAppointments.some(
        (a) => currentTime < a.endTime && slotEnd > a.startTime,
      );

      if (!isTaken) {
        // Check if slot is in the future (for today only)
        let isFutureSlot = true;
        const todayStr = today.toISOString().split('T')[0];

        if (dateStr === todayStr) {
          const [slotHour, slotMinute] = currentTime.split(':').map(Number);

          // Add 30 minutes buffer to allow for booking
          const slotDateTime = new Date();
          slotDateTime.setHours(slotHour, slotMinute, 0, 0);

          const nowPlusBuffer = new Date();
          nowPlusBuffer.setMinutes(nowPlusBuffer.getMinutes() + 30); // 30 min buffer

          if (slotDateTime <= nowPlusBuffer) {
            isFutureSlot = false;
            console.log(
              `  => Slot ${currentTime} is not in the future (requires 30 min advance)`,
            );
          }
        }

        if (isFutureSlot) {
          allSlots.push({
            startTime: currentTime,
            endTime: slotEnd,
            startTimeDisplay: formatTimeTo12HourDisplay(currentTime),
            endTimeDisplay: formatTimeTo12HourDisplay(slotEnd),
          });
        }
      } else {
        console.log(`  => Slot ${currentTime}-${slotEnd} is taken`);
      }

      currentTime = slotEnd;
    }

    console.log(`  => Available slots generated: ${allSlots.length}`);

    return allSlots;
  }

  // NEW HELPER: Convert day number to string
  private getDayOfWeekString(dayNumber: number): string {
    const days = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ];
    return days[dayNumber];
  }
}

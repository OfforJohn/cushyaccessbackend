import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { UploadDoctorDocumentsUseCase } from '../usecases/upload-doctor-documents.usecase';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import { Public } from 'src/auth/service/public.decorator';
import { SaveScheduleUseCase } from '../usecases/save-schedule.usecase';
import { DoctorService } from '../doctor.service';
import { SaveScheduleDto } from '../DTO/save-schedule.dto';
import { AvailableDoctorsQueryDto } from '../DTO/available-doctors.query.dto';
import { AppointmentUseCase } from '../usecases/book-appointment.usecase';
import { BookAppointmentDto } from '../DTO/book-appointment.dto';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { Permit } from 'src/auth/service/roles.decorator';
import { CompleteAppointmentUsecase } from '../usecases/complete-appointment.usecase';
import { ApprovalStatus } from '../models/enums/approval-status.enum';
import { ConsultationStatus } from '../models/enums/consultation-status.enum';
import { FindDoctorUseCase } from '../usecases/find-doctor.usecase';
import { GetAvailableSlotsDto } from '../DTO/get-available-slots.dto';
import { FindDoctorsDto } from '../DTO/find-doctors.dto';

@Controller('api/v1/doctor')
export class DoctorController {
  constructor(
    private readonly uploadDoctorDocumentsUseCase: UploadDoctorDocumentsUseCase,
    private readonly saveScheduleUseCase: SaveScheduleUseCase,
    private readonly appointmentUseCase: AppointmentUseCase,
    private readonly completeAppointmentUseCase: CompleteAppointmentUsecase,
    private readonly findDoctorsUseCase: FindDoctorUseCase,
    private readonly doctorService: DoctorService,
  ) {}

  @Public()
  @Post('upload-documents')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'medicalLicense', maxCount: 1 },
      { name: 'governmentId', maxCount: 1 },
      { name: 'professionalCertificate', maxCount: 1 },
    ]),
  )
  async uploadDocs(
    @Req() req,
    @UploadedFiles()
    files: {
      medicalLicense?: Express.Multer.File[];
      governmentId?: Express.Multer.File[];
      professionalCertificate?: Express.Multer.File[];
    },
  ) {
    return this.uploadDoctorDocumentsUseCase.execute({
      medicalLicense: files.medicalLicense?.[0],
      governmentId: files.governmentId?.[0],
      professionalCertificate: files.professionalCertificate?.[0],
    });
  }

  @Post('save-schedule')
  @Permit([UserRoles.DOCTOR])
  async saveSchedule(@Body() dto: SaveScheduleDto) {
    const result = await this.saveScheduleUseCase.execute(dto);

    return result;
  }
  @Get('get-schedule')
  async getSchedule() {
    return this.doctorService.getSchedule();
  }
  @Get('available')
  @Permit([UserRoles.CUSTOMER])
  async getAvailableDoctors(@Query() query: AvailableDoctorsQueryDto) {
    return await this.doctorService.getAvailableDoctors(query);
  }

  @Get('availability')
  @Permit([UserRoles.DOCTOR])
  async getAvailability() {
    return await this.doctorService.getAvailability();
  }

  @Get('profile')
  @Permit([UserRoles.DOCTOR])
  async getDoctorProfile() {
    return await this.doctorService.getDoctorProfileSummary();
  }

  @Get('profile/:doctorId')
  @Permit([UserRoles.CUSTOMER, UserRoles.DOCTOR])
  async getPublicDoctorProfile(@Param('doctorId') doctorId: string) {
    return await this.doctorService.getPublicDoctorProfile(doctorId);
  }

  @Patch('professional-bio')
  @Permit([UserRoles.DOCTOR])
  async updateProfessionalBio(
    @Body('professionalBio') professionalBio: string,
  ) {
    return await this.doctorService.updateProfessionalBio(professionalBio);
  }

  @Patch('availability')
  @Permit([UserRoles.DOCTOR])
  async updateAvailability(@Body('isAvailable') isAvailable: boolean) {
    return await this.doctorService.updateAvailability(isAvailable);
  }
  @Post('available-slots')
  async getAvailableSlots(@Body() dto: GetAvailableSlotsDto) {
    return this.appointmentUseCase.getAvailableSlots(dto);
  }
  @Post('book-appointment')
  @Permit([UserRoles.CUSTOMER])
  async book(@Body() dto: BookAppointmentDto) {
    const appointment = await this.appointmentUseCase.execute(dto);

    return appointment;
  }
  @Get('get-new-appointments')
  @Permit([UserRoles.DOCTOR])
  async getNewAppointments() {
    return await this.doctorService.getNewAppointments();
  }
  @Get('get-scheduled-appointments')
  @Permit([UserRoles.DOCTOR])
  async getScheduledAppointments() {
    return await this.doctorService.getScheduledAppointments();
  }
  @Post('acknowledge-appointment')
  @Permit([UserRoles.DOCTOR])
  async acknowledgeAppointment(@Body('appointmentId') appointmentId: string) {
    return await this.doctorService.acknowledgeAppointment(appointmentId);
  }
  @Post('reject-appointment')
  @Permit([UserRoles.DOCTOR])
  async rejectAppointment(@Body('appointmentId') appointmentId: string) {
    return await this.doctorService.rejectAppointmentByDoctor(appointmentId);
  }
  @Get('get-completed-appointments')
  @Permit([UserRoles.DOCTOR])
  async getCompletedAppointments() {
    return await this.doctorService.getCompletedAppointments();
  }
  @Get('get-cancelled-appointments')
  @Permit([UserRoles.DOCTOR])
  async getCancelledAppointments() {
    return await this.doctorService.getCancelledAppointments();
  }
  @Get('get-ongoing-appointments')
  @Permit([UserRoles.DOCTOR])
  async getOngoingAppointments() {
    return await this.doctorService.getOngoingAppointments();
  }
  @Get('user-upcoming-appointments')
  @Permit([UserRoles.CUSTOMER])
  async getUpcomingAppointments() {
    return await this.doctorService.getUpcomingAppointments();
  }
  @Get('user-past-appointments')
  @Permit([UserRoles.CUSTOMER])
  async getPastAppointments() {
    return await this.doctorService.getPastAppointments();
  }
  @Post('user-cancel-appointment')
  @Permit([UserRoles.CUSTOMER])
  async cancelAppointment(@Body('appointmentId') appointmentId: string) {
    return await this.doctorService.cancelAppointmentByUser(appointmentId);
  }
  // Admin-only: sets ONE health consultation fee that applies to every doctor.
  // Individual doctors can no longer set their own fee (rule: one fee for all).
  @Post('update-consultation-fee')
  @Permit([UserRoles.ADMIN])
  async updateConsultationFee(
    @Body('consultationFee') consultationFee: number,
  ) {
    return await this.doctorService.updateConsultationFee(consultationFee);
  }

  // Public read of the current global consultation fee (mobile pre-booking gate).
  @Public()
  @Get('consultation-fee')
  async getConsultationFee() {
    return await this.doctorService.getGlobalConsultationFee();
  }
  @Post('upload-profile-picture')
  @UseInterceptors(FileInterceptor('profilePicture'))
  async uploadDoctorProfilePicture(@UploadedFile() file: Express.Multer.File) {
    return await this.doctorService.uploadDoctorProfilePicture(file);
  }

  @Post('complete-appointment')
  @Permit([UserRoles.DOCTOR])
  async completeAppointment(@Query('appointmentId') appointmentId: string) {
    return await this.completeAppointmentUseCase.execute(appointmentId);
  }
  @Public()
  @Post('verify-doctor')
  async verifyDoctor(
    @Body('doctorId') doctorId: string,
    @Body('approvalStatus') approvalStatus: ApprovalStatus,
  ) {
    return await this.doctorService.verifyDoctor(doctorId, approvalStatus);
  }
  @Public()
  @Get('get-doctors-with-pending-verification')
  async getDoctorsWithPendingVerification() {
    return await this.doctorService.getDoctorsWithPendingVerification();
  }

  @Public()
  @Get('verification-status/:doctorId')
  async getVerificationStatus(@Param('doctorId') doctorId: string) {
    return await this.doctorService.getVerificationStatus(doctorId);
  }
  @Public()
  @Get('get-all-appointments-stats')
  async getAllAppointmentsStats() {
    return await this.doctorService.getAllAppointmentsStats();
  }
  @Public()
  @Get('get-all-appointments')
  async getAllAppointments(@Query('status') status?: ConsultationStatus) {
    return await this.doctorService.getAllAppointments(status);
  }
  @Public()
  @Get('get-all-doctors')
  async getAllDoctors() {
    return await this.doctorService.getAllDoctors();
  }

  @Permit([UserRoles.CUSTOMER, UserRoles.ADMIN])
  @Get('get-doctors-by-category')
  async getDoctorsByCategory(@Query('category') category: string) {
    return await this.doctorService.getDoctorsByCategory(category);
  }

  @Post('create-prescription')
  @UseInterceptors(
    FileInterceptor('signature', {
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowedMimes = [
          'image/png',
          'image/jpeg',
          'image/jpg',
          'image/gif',
        ];
        if (allowedMimes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              'Only image files are allowed (PNG, JPG, JPEG, GIF)',
            ),
            false,
          );
        }
      },
    }),
  )
  async createPrescription(
    @Req() req: any,
    @UploadedFile() signatureFile?: Express.Multer.File,
  ) {
    // Helper function to safely parse JSON (only for medications)
    const safeJsonParse = (jsonString: string, fieldName: string) => {
      if (!jsonString) return null;

      try {
        // Clean the string - remove any extra escaping
        let cleaned = jsonString;

        if (typeof cleaned === 'string') {
          // Remove any BOM characters
          if (cleaned.charCodeAt(0) === 0xfeff) {
            cleaned = cleaned.slice(1);
          }

          // Replace any remaining escaped quotes
          cleaned = cleaned.replace(/\\"/g, '"');

          console.log(`Cleaned ${fieldName}:`, cleaned);
        }

        return JSON.parse(cleaned);
      } catch (error) {
        console.error(`Failed to parse ${fieldName}:`, jsonString);
        throw new BadRequestException(
          `Invalid ${fieldName} format. Expected valid JSON array.`,
        );
      }
    };

    // ONLY parse medications - it's JSON
    const medications = req.body.medications
      ? safeJsonParse(req.body.medications, 'medications')
      : null;

    // Diagnosis is a plain string - DON'T parse it
    const diagnosis = req.body.diagnosis; // Just use as is

    const payload = {
      appointmentId: req.body.appointmentId,
      patientId: req.body.patientId,
      diagnosis: diagnosis, // Plain string
      notes: req.body.notes || req.body.note,
      medications: medications, // Parsed array
    };

    console.log('Final payload:', JSON.stringify(payload, null, 2));

    // Validate
    if (!payload.appointmentId) {
      throw new BadRequestException('appointmentId is required');
    }
    if (!payload.patientId) {
      throw new BadRequestException('patientId is required');
    }
    if (!payload.diagnosis) {
      throw new BadRequestException('diagnosis is required');
    }
    if (
      !payload.medications ||
      !Array.isArray(payload.medications) ||
      payload.medications.length === 0
    ) {
      throw new BadRequestException('At least one medication is required');
    }

    if (!signatureFile) {
      throw new BadRequestException('Signature is required');
    }

    return await this.doctorService.createPrescription(payload, signatureFile);
  }
  @Permit([UserRoles.CUSTOMER])
  @Post('find-doctors')
  async findDoctor(@Body() request: FindDoctorsDto) {
    return await this.findDoctorsUseCase.execute(request.symptoms);
  }
}

import { Controller, Get, Patch, Param, Body, Post } from '@nestjs/common';
import {
  DoctorViewConsultationRequestUseCase,
  DoctorConsultationAction,
} from '../usecases/doctor-view-consultation-request.usecase';
import { DoctorService } from '../doctor.service';
import { CompleteAppointmentUsecase } from '../usecases/complete-appointment.usecase';

@Controller('api/v1/consultations')
export class ConsultationController {
  constructor(
    private readonly doctorViewUseCase: DoctorViewConsultationRequestUseCase,
    private readonly doctorService: DoctorService,
    private readonly completeAppointmentUseCase: CompleteAppointmentUsecase,
  ) {}

  /** Current user: restore pending or in-session consultation after app reopen */
  @Get('active')
  getActiveConsultation() {
    return this.doctorService.getActiveConsultationForCurrentUser();
  }

  /** Patient: cancel all pending live requests for their current search */
  @Post('cancel-current')
  cancelCurrentPendingConsultation() {
    return this.doctorService.cancelCurrentPendingConsultation();
  }

  /** Doctor: get all their pending requests */
  @Get('pending')
  getPendingRequests() {
    return this.doctorViewUseCase.getPendingRequests();
  }

  /** Current user: fetch completed consultation summary */
  @Get(':appointmentId/summary')
  getConsultationSummary(@Param('appointmentId') appointmentId: string) {
    return this.doctorService.getConsultationSummary(appointmentId);
  }

  /** Patient: cancel a specific pending/booked consultation before it starts */
  @Patch(':appointmentId/cancel')
  cancelConsultation(@Param('appointmentId') appointmentId: string) {
    return this.doctorService.cancelAppointmentByUser(appointmentId);
  }

  /** Patient or doctor: complete an active consultation after ending the call */
  @Patch(':appointmentId/complete')
  completeConsultation(@Param('appointmentId') appointmentId: string) {
    return this.completeAppointmentUseCase.execute(appointmentId);
  }

  /** Patient or doctor: start an acknowledged scheduled consultation when its join window opens */
  @Patch(':appointmentId/start')
  startConsultation(@Param('appointmentId') appointmentId: string) {
    return this.completeAppointmentUseCase.start(appointmentId);
  }

  /** Doctor: get details of a single request */
  @Get(':appointmentId')
  getConsultationRequest(@Param('appointmentId') appointmentId: string) {
    return this.doctorViewUseCase.getConsultationRequest(appointmentId);
  }

  /** Doctor: accept or reject */
  @Patch(':appointmentId/respond')
  respondToRequest(
    @Param('appointmentId') appointmentId: string,
    @Body('action') action: DoctorConsultationAction,
  ) {
    return this.doctorViewUseCase.respondToRequest(appointmentId, action);
  }
}

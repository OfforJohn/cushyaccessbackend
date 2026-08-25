export class ConsultationRequestEvent {
  constructor(
    public readonly doctorId: string,
    public readonly payload: ConsultationRequestPayload,
  ) {}
}

export interface ConsultationRequestPayload {
  appointmentId: string;
  patientId: string;
  patientName: string;
  patientEmail: string;
  patientPhone: string;
  symptoms: string;
  specialty: string;
  urgency: string;
  confidence: number;
  reasoning: string;
  consultationFee: number;
  consultationType: string;
  roomId: string;
  meetingLink: string;
  doctorMeetingLink: string;
  patientMeetingLink: string;
  requestedAt: string;
}

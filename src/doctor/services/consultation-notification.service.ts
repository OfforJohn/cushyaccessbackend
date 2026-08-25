import { Injectable, Logger } from '@nestjs/common';
import { ConsultationGatewayService } from '../gateways/consultation-gateway.service';

@Injectable()
export class ConsultationNotificationService {
  private readonly logger = new Logger(ConsultationNotificationService.name);

  constructor(private readonly gatewayService: ConsultationGatewayService) {}

  notifyDoctor(doctorId: string, payload: any) {
    this.logger.log(`Emitting consultation request to doctor ${doctorId}`);
    this.gatewayService.emitToDoctor(doctorId, 'consultation_request', {
      event: 'INCOMING_CONSULTATION_REQUEST',
      ...payload,
    });
  }
}

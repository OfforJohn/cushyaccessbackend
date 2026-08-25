import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { ConsultationRequestEvent } from './consultation-request.event';
import { Logger } from '@nestjs/common';
import { ConsultationNotificationService } from '../services/consultation-notification.service';

@EventsHandler(ConsultationRequestEvent)
export class ConsultationRequestHandler implements IEventHandler<ConsultationRequestEvent> {
  private readonly logger = new Logger(ConsultationRequestHandler.name);

  constructor(
    private readonly notificationService: ConsultationNotificationService,
  ) {}

  handle(event: ConsultationRequestEvent) {
    const { doctorId, payload } = event;
    this.logger.log(`Handling consultation request for doctor ${doctorId}`);

    // Use the shared service to emit via WebSocket
    this.notificationService.notifyDoctor(doctorId, payload);
  }
}

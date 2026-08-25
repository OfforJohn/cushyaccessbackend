import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { MailSenderService } from '../mail-sender.service';
import { OrderUpdateEvent } from '../events/order-update.event';

@EventsHandler(OrderUpdateEvent)
export class OrderUpdateEventHandler
  implements IEventHandler<OrderUpdateEvent>
{
  constructor(private readonly mailSenderService: MailSenderService) {}

  async handle(orderUpdateEvent: OrderUpdateEvent) {
    try {
      const orderStatusFormatted = (orderUpdateEvent.orderStatus || '')
        .toLowerCase()
        .replace('_', ' ');
      await this.mailSenderService.sendMail({
        recipient: orderUpdateEvent.recipient,
        subject: `Order ${orderStatusFormatted}`,
        content: { ...orderUpdateEvent },
        template: 'order-status-update',
      });
    } catch (err) {
      // Non-blocking error handling
    }
  }
}

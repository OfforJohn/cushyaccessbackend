import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderCreateEvent } from '../events/order-create.event';
import { MailSenderService } from '../mail-sender.service';

@EventsHandler(OrderCreateEvent)
export class OrderCreateEventHandler
  implements IEventHandler<OrderCreateEvent>
{
  constructor(private readonly mailSenderService: MailSenderService) {}

  async handle(orderCreateEvent: OrderCreateEvent) {
    await this.mailSenderService.sendMail({
      recipient: orderCreateEvent.recipient,
      subject: 'Delivery Confirmation',
      content: { ...orderCreateEvent },
      template: 'logistics-order-confirmation',
      bcc: ['ornagletransact@gmail.com'],
    });
  }
}

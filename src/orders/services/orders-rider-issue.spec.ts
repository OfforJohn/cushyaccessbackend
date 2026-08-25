import { OrdersService } from './orders.service';

describe('OrdersService rider issue reporting', () => {
  const buildService = (mailResult: unknown = { messageId: 'mail_1' }) => {
    const rider = {
      id: 'rider_1',
      userId: 'user_1',
      user: {
        firstName: 'Ada',
        lastName: 'Okafor',
        mobile: '8012345678',
      },
    };
    const ordersRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'order_1',
        riderId: rider.id,
        status: 'IN_TRANSIT',
        store: { name: 'Chicken Republic' },
        user: { firstName: 'John', lastName: 'Doe' },
        pickUpLocation: { address: 'New Nyanya' },
        dropOffLocation: { address: 'Ado' },
      }),
    };
    const analyticsService = {
      trackUserActivity: jest.fn().mockResolvedValue({ id: 'issue_1' }),
    };
    const mailSenderService = {
      sendMail: jest.fn().mockResolvedValue(mailResult),
    };
    const service = Object.create(OrdersService.prototype) as OrdersService;
    Object.assign(service, {
      riderService: { findByUserId: jest.fn().mockResolvedValue(rider) },
      ordersRepository,
      analyticsService,
      mailSenderService,
      logger: { warn: jest.fn() },
    });
    return { service, ordersRepository, analyticsService, mailSenderService };
  };

  it('persists the report and queues a traceable support email', async () => {
    const { service, ordersRepository, analyticsService, mailSenderService } =
      buildService();

    const response = await service.reportRiderIssue('order_1', 'user_1', {
      category: "Can't reach customer",
      description: 'Customer is not answering repeated calls.',
      latitude: 9.015,
      longitude: 7.568,
    });

    expect(ordersRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          { id: 'order_1', riderId: 'rider_1' },
          { id: 'order_1', riderId: 'user_1' },
        ],
      }),
    );
    expect(analyticsService.trackUserActivity).toHaveBeenCalledWith(
      'user_1',
      'rider_order_issue',
      expect.objectContaining({
        orderId: 'order_1',
        riderId: 'rider_1',
        category: "Can't reach customer",
      }),
    );
    expect(mailSenderService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: 'support@cushyaccess.com',
        template: 'rider-delivery-issue',
        content: expect.objectContaining({ reference: 'issue_1' }),
      }),
    );
    expect(response.toJSON()).toMatchObject({
      error: false,
      data: { reference: 'issue_1', supportNotificationQueued: true },
    });
  });

  it('does not delay or fail the recorded report when email is unavailable', async () => {
    const { service } = buildService(null);

    const response = await service.reportRiderIssue('order_1', 'user_1', {
      category: 'Wrong address',
      description: 'The supplied address does not match the map location.',
    });

    expect(response.toJSON()).toMatchObject({
      error: false,
      data: { reference: 'issue_1', supportNotificationQueued: true },
    });
  });

  it('responds after persistence without waiting for a slow email provider', async () => {
    const { service, mailSenderService } = buildService();
    mailSenderService.sendMail.mockImplementation(
      () => new Promise(() => undefined),
    );

    const response = await service.reportRiderIssue('order_1', 'user_1', {
      category: 'Unsafe delivery location',
      description: 'There is an active safety hazard at the drop-off point.',
    });

    expect(response.toJSON()).toMatchObject({
      error: false,
      data: { reference: 'issue_1', supportNotificationQueued: true },
    });
  });
});

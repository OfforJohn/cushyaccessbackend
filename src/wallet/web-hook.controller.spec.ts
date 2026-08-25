/// <reference types="jest" />

import * as crypto from 'crypto';
import { PayoutStatus } from 'src/users/model/payout-status.enum';
import { WebhookController } from './web-hook.controller';

describe('WebhookController Paystack verification', () => {
  const originalSecret = process.env.PAYSTACK_SECRET_KEY;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = originalSecret;
  });

  it('verifies the preserved raw body and routes a transfer exactly once', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'webhook-test-secret';
    const payoutService = { updateStatus: jest.fn() };
    const controller = new WebhookController(
      {} as never,
      payoutService as never,
      {} as never,
    );
    const rawBody = Buffer.from(
      '{\n  "event": "transfer.success", "data": { "reference": "PAYOUT-1", "status": "success", "transfer_code": "TRF-1" }\n}',
    );
    const body = JSON.parse(rawBody.toString());
    const signature = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest('hex');
    const response = { sendStatus: jest.fn((status: number) => status) };

    await controller.handlePaystackWebhook(
      { body, rawBody, headers: { 'x-paystack-signature': signature } },
      response,
    );

    expect(payoutService.updateStatus).toHaveBeenCalledTimes(1);
    expect(payoutService.updateStatus).toHaveBeenCalledWith(
      'PAYOUT-1',
      PayoutStatus.APPROVED,
      'success',
      'TRF-1',
    );
    expect(response.sendStatus).toHaveBeenCalledWith(200);
  });

  it('routes new lowercase doctor references while retaining legacy compatibility', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'webhook-test-secret';
    const doctorPayoutService = {
      updateDoctorPayoutStatus: jest.fn(),
    };
    const controller = new WebhookController(
      {} as never,
      {} as never,
      doctorPayoutService as never,
    );
    const rawBody = Buffer.from(
      '{"event":"transfer.success","data":{"reference":"dpayout-1720000000000-abc123","status":"success","transfer_code":"TRF-2"}}',
    );
    const signature = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest('hex');
    const response = { sendStatus: jest.fn((status: number) => status) };

    await controller.handlePaystackWebhook(
      {
        body: JSON.parse(rawBody.toString()),
        rawBody,
        headers: { 'x-paystack-signature': signature },
      },
      response,
    );

    expect(doctorPayoutService.updateDoctorPayoutStatus).toHaveBeenCalledWith(
      'dpayout-1720000000000-abc123',
      PayoutStatus.APPROVED,
      'success',
      'TRF-2',
    );
  });
});

/// <reference types="jest" />

import axios from 'axios';
import { HttpException, HttpStatus } from '@nestjs/common';
import { PaystackService } from './paystack.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
  },
}));

describe('PaystackService bulk transfers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an actionable service error when provider credentials are absent', () => {
    const service = new PaystackService();
    (service as unknown as { PAYSTACK_SECRET?: string }).PAYSTACK_SECRET =
      undefined;

    try {
      service.assertConfigured();
      throw new Error('Expected assertConfigured to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      expect((error as HttpException).getResponse()).toMatchObject({
        error: true,
        message: 'VIRTUAL_ACCOUNT_FEATURE_UNAVAILABLE',
      });
    }
  });

  it('sends currency and preserves each transfer reference', async () => {
    const post = axios.post as jest.MockedFunction<typeof axios.post>;
    post.mockResolvedValueOnce({
      data: {
        status: true,
        message: 'Transfers queued',
        data: [{ reference: 'PAYOUT-1', amount: 10000 }],
      },
    });
    const service = new PaystackService();
    (service as unknown as { PAYSTACK_SECRET?: string }).PAYSTACK_SECRET =
      'test-secret';
    const transfers = [
      {
        amount: 10000,
        recipient: 'RCP-code',
        reason: 'Settlement',
        reference: 'PAYOUT-1',
      },
    ];

    await service.initiateBulkTransfer(transfers);

    expect(post).toHaveBeenCalledWith(
      'https://api.paystack.co/transfer/bulk',
      { source: 'balance', currency: 'NGN', transfers },
      expect.objectContaining({ timeout: 30_000 }),
    );
  });

  it('reuses an existing Paystack customer instead of creating duplicates', async () => {
    const get = axios.get as jest.MockedFunction<typeof axios.get>;
    const post = axios.post as jest.MockedFunction<typeof axios.post>;
    get.mockResolvedValueOnce({
      data: { data: { customer_code: 'CUS_existing' } },
    });
    const service = new PaystackService();
    (service as unknown as { PAYSTACK_SECRET?: string }).PAYSTACK_SECRET =
      'sk_live_test';

    const customer = await service.getOrCreateCustomer(
      'ada@example.com',
      'Ada',
      'Lovelace',
      '+2348012345678',
    );

    expect(customer).toMatchObject({ customer_code: 'CUS_existing' });
    expect(post).not.toHaveBeenCalled();
  });

  it('creates a customer when Paystack has no existing record', async () => {
    const get = axios.get as jest.MockedFunction<typeof axios.get>;
    const post = axios.post as jest.MockedFunction<typeof axios.post>;
    get.mockRejectedValueOnce({ response: { status: 404 } });
    post.mockResolvedValueOnce({
      data: { data: { customer_code: 'CUS_new' } },
    });
    const service = new PaystackService();
    (service as unknown as { PAYSTACK_SECRET?: string }).PAYSTACK_SECRET =
      'sk_live_test';

    await expect(
      service.getOrCreateCustomer(
        'ada@example.com',
        'Ada',
        'Lovelace',
        '+2348012345678',
      ),
    ).resolves.toMatchObject({ customer_code: 'CUS_new' });
    expect(post).toHaveBeenCalledWith(
      'https://api.paystack.co/customer',
      expect.objectContaining({
        email: 'ada@example.com',
        phone: '+2348012345678',
      }),
      expect.objectContaining({ timeout: 20_000 }),
    );
  });

  it('always requests Paystack-Titan for a live DVA', async () => {
    const post = axios.post as jest.MockedFunction<typeof axios.post>;
    post.mockResolvedValueOnce({ data: { data: { account_number: '123' } } });
    const service = new PaystackService();
    (service as unknown as { PAYSTACK_SECRET?: string }).PAYSTACK_SECRET =
      'sk_live_test';

    await service.createDedicatedAccount(
      'CUS_existing',
      'Ada',
      'Lovelace',
      '+2348012345678',
    );

    expect(post).toHaveBeenCalledWith(
      'https://api.paystack.co/dedicated_account',
      {
        customer: 'CUS_existing',
        preferred_bank: 'titan-paystack',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone: '+2348012345678',
      },
      expect.objectContaining({ timeout: 20_000 }),
    );
  });

  it('uses Paystack test-bank only with a test secret', async () => {
    const post = axios.post as jest.MockedFunction<typeof axios.post>;
    post.mockResolvedValueOnce({ data: { data: { account_number: '123' } } });
    const service = new PaystackService();
    (service as unknown as { PAYSTACK_SECRET?: string }).PAYSTACK_SECRET =
      'sk_test_example';

    await service.createDedicatedAccount('CUS_test');

    expect(post).toHaveBeenCalledWith(
      'https://api.paystack.co/dedicated_account',
      {
        customer: 'CUS_test',
        preferred_bank: 'test-bank',
      },
      expect.objectContaining({ timeout: 20_000 }),
    );
  });

  it('maps a provider outage to a retryable service error', async () => {
    const post = axios.post as jest.MockedFunction<typeof axios.post>;
    post.mockRejectedValueOnce({ code: 'ECONNABORTED', message: 'timeout' });
    const service = new PaystackService();
    (service as unknown as { PAYSTACK_SECRET?: string }).PAYSTACK_SECRET =
      'sk_live_test';

    await expect(
      service.createDedicatedAccount('CUS_existing'),
    ).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: expect.objectContaining({
        message: 'VIRTUAL_ACCOUNT_PROVIDER_UNAVAILABLE',
      }),
    });
  });

  it('maps an unactivated DVA feature to an actionable service error', async () => {
    const post = axios.post as jest.MockedFunction<typeof axios.post>;
    post.mockRejectedValueOnce({
      response: {
        status: HttpStatus.FORBIDDEN,
        data: { message: 'Dedicated accounts are not activated' },
      },
    });
    const service = new PaystackService();
    (service as unknown as { PAYSTACK_SECRET?: string }).PAYSTACK_SECRET =
      'sk_live_test';

    await expect(
      service.createDedicatedAccount('CUS_existing'),
    ).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: expect.objectContaining({
        message: 'VIRTUAL_ACCOUNT_FEATURE_UNAVAILABLE',
      }),
    });
  });

  it('classifies invalid credentials before customer profile errors', async () => {
    const post = axios.post as jest.MockedFunction<typeof axios.post>;
    post.mockRejectedValueOnce({
      response: {
        status: HttpStatus.UNAUTHORIZED,
        data: { message: 'Invalid key' },
      },
    });
    const service = new PaystackService();
    (service as unknown as { PAYSTACK_SECRET?: string }).PAYSTACK_SECRET =
      'sk_live_invalid';

    await expect(
      service.createCustomer(
        'ada@example.com',
        'Ada',
        'Lovelace',
        '+2348012345678',
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: expect.objectContaining({
        message: 'VIRTUAL_ACCOUNT_FEATURE_UNAVAILABLE',
      }),
    });
  });

  it('classifies provider capacity before generic customer errors', async () => {
    const post = axios.post as jest.MockedFunction<typeof axios.post>;
    post.mockRejectedValueOnce({
      response: {
        status: HttpStatus.BAD_REQUEST,
        data: { message: 'Dedicated account limit reached' },
      },
    });
    const service = new PaystackService();
    (service as unknown as { PAYSTACK_SECRET?: string }).PAYSTACK_SECRET =
      'sk_live_test';

    await expect(
      service.createCustomer(
        'ada@example.com',
        'Ada',
        'Lovelace',
        '+2348012345678',
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: expect.objectContaining({
        message: 'VIRTUAL_ACCOUNT_PROVIDER_LIMIT_REACHED',
      }),
    });
  });
});

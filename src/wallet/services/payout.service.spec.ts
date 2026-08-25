/// <reference types="jest" />

import { PayoutStatus } from 'src/users/model/payout-status.enum';
import { PayoutTransactions } from 'src/users/model/payout-transactions.entity';
import { Wallets } from '../model/wallet.entity';
import { PayoutService } from './payout.service';

describe('PayoutService provider transitions', () => {
  const createHarness = (overrides: Partial<PayoutTransactions> = {}) => {
    const payout = {
      id: 'payout-id',
      reference: 'PAYOUT-reference',
      amount: 1250,
      status: PayoutStatus.PROCESSING,
      fundsReserved: true,
      reconciliationAttempts: 0,
      createdAt: new Date('2026-07-30T00:00:00.000Z'),
      vendor: { id: 'vendor-id' },
      orderIds: null,
      ...overrides,
    } as PayoutTransactions;
    const wallet = { id: 'wallet-id', userId: 'vendor-id' } as Wallets;
    const lockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => payout),
    };
    const manager = {
      createQueryBuilder: jest.fn(() => lockQueryBuilder),
      findOne: jest.fn(async (entity: unknown) =>
        entity === PayoutTransactions ? payout : wallet,
      ),
      save: jest.fn(async (_entity: unknown, value: unknown) => value),
      decrement: jest.fn(async () => ({ affected: 1 })),
      increment: jest.fn(async () => ({ affected: 1 })),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    const dataSource = {
      transaction: jest.fn(async (work: (value: typeof manager) => unknown) =>
        work(manager),
      ),
    };
    const repository = {
      find: jest.fn(async () => []),
      findOne: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const service = new PayoutService(
      repository as never,
      repository as never,
      repository as never,
      repository as never,
      dataSource as never,
      {} as never,
    );
    return { service, payout, manager, lockQueryBuilder };
  };

  it('finalizes a reserved payout without debiting the wallet again', async () => {
    const { service, payout, manager, lockQueryBuilder } = createHarness();

    await service.updateStatus(
      payout.reference,
      PayoutStatus.APPROVED,
      'success',
      'TRF-code',
    );

    expect(payout.status).toBe(PayoutStatus.APPROVED);
    expect(payout.providerReference).toBe('TRF-code');
    expect(manager.decrement).not.toHaveBeenCalled();
    expect(manager.increment).not.toHaveBeenCalled();
    expect(lockQueryBuilder.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
      undefined,
      ['payout'],
    );
  });

  it('debits a legacy unreserved payout exactly once', async () => {
    const { service, payout, manager } = createHarness({
      status: PayoutStatus.PENDING,
      fundsReserved: false,
    });

    await service.updateStatus(payout.reference, PayoutStatus.APPROVED);
    await service.updateStatus(payout.reference, PayoutStatus.APPROVED);

    expect(manager.decrement).toHaveBeenCalledTimes(1);
    expect(payout.fundsReserved).toBe(true);
  });

  it('restores reserved funds exactly once after a reversal', async () => {
    const { service, payout, manager } = createHarness({
      status: PayoutStatus.APPROVED,
      fundsReserved: true,
    });

    await service.updateStatus(payout.reference, PayoutStatus.REVERSED);
    await service.updateStatus(payout.reference, PayoutStatus.REVERSED);

    expect(manager.increment).toHaveBeenCalledTimes(1);
    expect(payout.fundsReserved).toBe(false);
    expect(payout.status).toBe(PayoutStatus.REVERSED);
  });

  it('restores funds when the provider later reports failure', async () => {
    const { service, payout, manager } = createHarness({
      status: PayoutStatus.APPROVED,
      fundsReserved: true,
    });

    await service.updateStatus(payout.reference, PayoutStatus.FAILED);

    expect(payout.status).toBe(PayoutStatus.FAILED);
    expect(manager.increment).toHaveBeenCalledTimes(1);
    expect(manager.decrement).not.toHaveBeenCalled();
  });

  it('approves a transfer once Paystack acknowledges its submission', async () => {
    const { service, payout } = createHarness();
    const applyProviderStatus = (service as any).applyProviderStatus.bind(
      service,
    );

    await applyProviderStatus(payout.reference, 'pending', 'TRF-code', true);

    expect(payout.status).toBe(PayoutStatus.APPROVED);
    expect(payout.providerStatus).toBe('pending');
  });

  it('approves an acknowledged transfer even when Paystack omits an item status', async () => {
    const { service, payout } = createHarness();
    const applyProviderStatus = (service as any).applyProviderStatus.bind(
      service,
    );

    await applyProviderStatus(payout.reference, undefined, 'TRF-code', true);

    expect(payout.status).toBe(PayoutStatus.APPROVED);
    expect(payout.providerStatus).toBe('accepted');
  });

  it('rejects a negative top-level Paystack submission response', () => {
    const { service } = createHarness();
    const assertAccepted = (service as any).assertBulkSubmissionAccepted.bind(
      service,
    );

    expect(() =>
      assertAccepted({ status: false, message: 'Transfer rejected' }),
    ).toThrow('Transfer rejected');
  });

  it('keeps a pending reconciliation result pending without a submission acknowledgement', async () => {
    const { service, payout } = createHarness();
    const applyProviderStatus = (service as any).applyProviderStatus.bind(
      service,
    );

    await applyProviderStatus(payout.reference, 'pending', 'TRF-code');

    expect(payout.status).toBe(PayoutStatus.PENDING);
  });

  it('releases reserved funds when the provider definitively fails', async () => {
    const { service, payout, manager } = createHarness();

    await service.updateStatus(payout.reference, PayoutStatus.FAILED);

    expect(manager.increment).toHaveBeenCalledTimes(1);
    expect(payout.fundsReserved).toBe(false);
    expect(payout.status).toBe(PayoutStatus.FAILED);
  });

  it('bounds provider submissions to 100 items per request', () => {
    const { service } = createHarness();
    const chunk = (
      service as unknown as {
        chunk<T>(items: T[], size: number): T[][];
      }
    ).chunk.bind(service);

    expect(
      chunk(Array.from({ length: 205 }), 100).map((part) => part.length),
    ).toEqual([100, 100, 5]);
  });

  it('releases reservations only for definitive client-side provider failures', () => {
    const { service } = createHarness();
    const classify = (
      service as unknown as {
        isDefinitiveSubmissionFailure(status?: number): boolean;
      }
    ).isDefinitiveSubmissionFailure.bind(service);

    expect(classify(400)).toBe(true);
    expect(classify(422)).toBe(true);
    expect(classify(408)).toBe(false);
    expect(classify(429)).toBe(false);
    expect(classify(500)).toBe(false);
    expect(classify(undefined)).toBe(false);
  });

  it('records reconciliation failures under the payout row lock', async () => {
    const { service, payout, manager } = createHarness();
    const recordFailure = (
      service as unknown as {
        recordReconciliationFailure(
          id: string,
          message: string,
        ): Promise<{ active: boolean; attempts: number }>;
      }
    ).recordReconciliationFailure.bind(service);

    const result = await recordFailure(payout.id, 'temporary provider error');

    expect(result).toEqual(
      expect.objectContaining({ active: true, attempts: 1 }),
    );
    expect(payout.reconciliationAttempts).toBe(1);
    expect(payout.remark).toBe('Awaiting provider confirmation.');
    expect(manager.save).toHaveBeenCalledTimes(1);
  });

  it('clears an old technical reconciliation note after provider confirmation', async () => {
    const { service, payout } = createHarness({
      status: PayoutStatus.APPROVED,
      providerStatus: 'pending',
      remark:
        'Reconciliation pending: FOR UPDATE cannot be applied to the nullable side of an outer join',
    });

    await service.updateStatus(
      payout.reference,
      PayoutStatus.APPROVED,
      'success',
      'TRF-confirmed',
    );

    expect(payout.remark).toBeNull();
    expect(payout.providerStatus).toBe('success');
    expect(payout.providerReference).toBe('TRF-confirmed');
  });

  it('continues reconciling acknowledged payouts until Paystack settles them', async () => {
    const { service, payout } = createHarness({
      status: PayoutStatus.APPROVED,
      providerStatus: 'pending',
    });
    const recordFailure = (service as any).recordReconciliationFailure.bind(
      service,
    );

    const result = await recordFailure(payout.id, 'temporary provider error');

    expect(result.active).toBe(true);
    expect(payout.reconciliationAttempts).toBe(1);
  });

  it('does not overwrite a payout that completed during reconciliation', async () => {
    const { service, payout, manager } = createHarness({
      status: PayoutStatus.APPROVED,
      remark: 'Provider confirmed success',
    });
    const recordFailure = (
      service as unknown as {
        recordReconciliationFailure(
          id: string,
          message: string,
        ): Promise<{ active: boolean }>;
      }
    ).recordReconciliationFailure.bind(service);

    const result = await recordFailure(payout.id, 'stale verification error');

    expect(result.active).toBe(false);
    expect(payout.remark).toBe('Provider confirmed success');
    expect(manager.save).not.toHaveBeenCalled();
  });
});

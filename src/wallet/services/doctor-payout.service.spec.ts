/// <reference types="jest" />

import { Appointment } from '../../doctor/models/appointment.entity';
import { PayoutTransactions } from '../../users/model/payout-transactions.entity';
import { PayoutStatus } from '../../users/model/payout-status.enum';
import { Wallets } from '../model/wallet.entity';
import { DoctorPayoutService } from './doctor-payout.service';

describe('DoctorPayoutService transitions', () => {
  const createHarness = (status = PayoutStatus.PENDING) => {
    const payout = {
      id: 'payout-id',
      reference: 'DPAYOUT-ref',
      status,
      amount: 5000,
      vendor: { id: 'doctor-id' },
      orderIds: ['appointment-id'],
    } as PayoutTransactions;
    const wallet = { id: 'wallet-id' } as Wallets;
    const manager = {
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
    };
    const service = new DoctorPayoutService(
      repository as never,
      repository as never,
      repository as never,
      dataSource as never,
      {} as never,
    );
    return { service, payout, manager };
  };

  it('debits and marks appointments once on provider success', async () => {
    const { service, payout, manager } = createHarness();

    await service.updateDoctorPayoutStatus(
      payout.reference,
      PayoutStatus.APPROVED,
      'success',
      'TRF-code',
    );
    await service.updateDoctorPayoutStatus(
      payout.reference,
      PayoutStatus.APPROVED,
      'success',
      'TRF-code',
    );

    expect(manager.decrement).toHaveBeenCalledTimes(1);
    expect(manager.update).toHaveBeenCalledWith(
      Appointment,
      expect.anything(),
      { isPaidOut: true },
    );
    expect(payout.providerReference).toBe('TRF-code');
  });

  it('restores the wallet once on reversal', async () => {
    const { service, payout, manager } = createHarness(PayoutStatus.APPROVED);

    await service.updateDoctorPayoutStatus(
      payout.reference,
      PayoutStatus.REVERSED,
    );
    await service.updateDoctorPayoutStatus(
      payout.reference,
      PayoutStatus.REVERSED,
    );

    expect(manager.increment).toHaveBeenCalledTimes(1);
    expect(manager.update).toHaveBeenCalledWith(
      Appointment,
      expect.anything(),
      { isPaidOut: false },
    );
  });

  it('approves an acknowledged Paystack submission without waiting for a webhook', async () => {
    const { service, payout, manager } = createHarness();
    const applyProviderStatus = (service as any).applyProviderStatus.bind(
      service,
    );

    await applyProviderStatus(payout.reference, 'pending', 'TRF-code', true);

    expect(payout.status).toBe(PayoutStatus.APPROVED);
    expect(manager.decrement).toHaveBeenCalledTimes(1);
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

  it('restores an approved payout when Paystack later reports failure', async () => {
    const { service, payout, manager } = createHarness(PayoutStatus.APPROVED);

    await service.updateDoctorPayoutStatus(
      payout.reference,
      PayoutStatus.FAILED,
      'failed',
    );
    await service.updateDoctorPayoutStatus(
      payout.reference,
      PayoutStatus.FAILED,
      'failed',
    );

    expect(payout.status).toBe(PayoutStatus.FAILED);
    expect(manager.increment).toHaveBeenCalledTimes(1);
    expect(manager.update).toHaveBeenCalledWith(
      Appointment,
      expect.anything(),
      { isPaidOut: false },
    );
  });

  it('does not turn a transport ambiguity into a failed payout', async () => {
    const { service } = createHarness();
    const repository = (service as any).payoutRepo;
    const markAmbiguous = (service as any).markSubmissionAmbiguous.bind(
      service,
    );

    await markAmbiguous('DPAYOUT-ref', 'socket timeout');

    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'DPAYOUT-ref' }),
      expect.objectContaining({ providerStatus: 'unknown' }),
    );
  });
});

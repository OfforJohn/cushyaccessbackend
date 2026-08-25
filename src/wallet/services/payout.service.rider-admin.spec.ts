/// <reference types="jest" />

import { Rider } from 'src/riders/model/rider.entity';
import { PayoutTransactions } from 'src/users/model/payout-transactions.entity';
import { PayoutStatus } from 'src/users/model/payout-status.enum';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { Users } from 'src/users/model/users.entity';
import { Wallets } from '../model/wallet.entity';
import { PayoutService } from './payout.service';

const createListQueryBuilder = (payouts: PayoutTransactions[] = []) => ({
  leftJoin: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn(async () => [payouts, payouts.length]),
});

const createStatsQueryBuilder = () => ({
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  setParameters: jest.fn().mockReturnThis(),
  getRawOne: jest.fn(async () => ({
    totalPending: '2500',
    totalCompleted: '9000',
    pendingCount: '2',
    completedCount: '4',
    processingCount: '1',
    failedCount: '1',
    reversedCount: '0',
  })),
});

const createService = ({
  payoutRepo = {},
  riderRepo = {},
  dataSource = {},
  paystack = {},
}: {
  payoutRepo?: object;
  riderRepo?: object;
  dataSource?: object;
  paystack?: object;
}) =>
  new PayoutService(
    {} as never,
    payoutRepo as never,
    {} as never,
    riderRepo as never,
    dataSource as never,
    paystack as never,
  );

describe('PayoutService rider admin isolation', () => {
  it('returns only RIDER-role payouts and includes the rider profile summary', async () => {
    const user = {
      id: 'user-rider-1',
      firstName: 'Ada',
      lastName: 'Rider',
      userRole: UserRoles.RIDER,
    } as Users;
    const payout = {
      id: 'payout-1',
      vendor: user,
      amount: 1500,
      accountNumber: '0123456789',
      status: PayoutStatus.APPROVED,
    } as PayoutTransactions;
    const queryBuilder = createListQueryBuilder([payout]);
    const riderRepo = {
      find: jest.fn(async () => [
        {
          id: 'rider-1',
          userId: user.id,
          bikeType: 'motorcycle',
          licensePlate: 'ABC-123',
          payoutSchedule: 'weekly',
        },
      ]),
    };
    const service = createService({
      payoutRepo: { createQueryBuilder: jest.fn(() => queryBuilder) },
      riderRepo,
    });

    const response = (await service.getRiderPayouts()).toJSON();

    expect(queryBuilder.where).toHaveBeenCalledWith('vendor.userRole = :role', {
      role: UserRoles.RIDER,
    });
    expect(response.data).toEqual(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            vendorId: user.id,
            riderId: 'rider-1',
            accountNumber: '******6789',
            rider: expect.objectContaining({ licensePlate: 'ABC-123' }),
          }),
        ],
      }),
    );
  });

  it('keeps the existing merchant list scoped to VENDOR accounts', async () => {
    const queryBuilder = createListQueryBuilder();
    const riderRepo = { find: jest.fn() };
    const service = createService({
      payoutRepo: { createQueryBuilder: jest.fn(() => queryBuilder) },
      riderRepo,
    });

    await service.getAllPayouts();

    expect(queryBuilder.where).toHaveBeenCalledWith('vendor.userRole = :role', {
      role: UserRoles.VENDOR,
    });
    expect(riderRepo.find).not.toHaveBeenCalled();
  });

  it('calculates rider stats without mixing merchant or doctor payouts', async () => {
    const queryBuilder = createStatsQueryBuilder();
    const service = createService({
      payoutRepo: { createQueryBuilder: jest.fn(() => queryBuilder) },
    });

    const response = (await service.getRiderPayoutStats()).toJSON();

    expect(queryBuilder.where).toHaveBeenCalledWith('vendor.userRole = :role', {
      role: UserRoles.RIDER,
    });
    expect(response.data).toEqual(
      expect.objectContaining({
        totalPending: 2500,
        totalCompleted: 9000,
        pendingCount: 2,
      }),
    );
  });
});

describe('PayoutService rider admin eligibility and races', () => {
  const riderQuery = (riders: Rider[]) => ({
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn(async () => riders),
  });

  const riderWithBalance = (overrides: Partial<Rider> = {}) =>
    ({
      id: 'rider-1',
      bankName: 'Test Bank',
      accountNumber: '0123456789',
      bankCode: '001',
      accountHolderName: 'Ada Rider',
      bankDetailsVerified: true,
      recipientCode: 'RCP-rider-1',
      payoutSchedule: 'weekly',
      user: {
        id: 'user-rider-1',
        firstName: 'Ada',
        lastName: 'Rider',
        userRole: UserRoles.RIDER,
        wallet: { id: 'wallet-1', walletBalance: 5000 },
      },
      ...overrides,
    }) as Rider;

  it.each([
    {
      label: 'unverified bank details',
      overrides: { bankDetailsVerified: false },
    },
    {
      label: 'a stale non-rider user relation',
      overrides: {
        user: {
          id: 'user-rider-1',
          firstName: 'Ada',
          lastName: 'Rider',
          userRole: UserRoles.VENDOR,
          wallet: { id: 'wallet-1', walletBalance: 5000 },
        } as Users,
      },
    },
  ])('does not settle $label', async ({ overrides }) => {
    const queryBuilder = riderQuery([riderWithBalance(overrides)]);
    const paystack = {
      assertConfigured: jest.fn(),
      createBulkTransferRecipient: jest.fn(),
      initiateBulkTransfer: jest.fn(),
    };
    const service = createService({
      payoutRepo: { findOne: jest.fn() },
      riderRepo: { createQueryBuilder: jest.fn(() => queryBuilder) },
      paystack,
    });

    const response = (
      await service.runRiderPayouts({ isManual: true })
    ).toJSON();

    expect(response.message).toBe('NO_ELIGIBLE_PAYOUTS');
    expect(paystack.createBulkTransferRecipient).not.toHaveBeenCalled();
    expect(paystack.initiateBulkTransfer).not.toHaveBeenCalled();
  });

  it('rechecks the locked wallet balance before creating a payout', async () => {
    const queryBuilder = riderQuery([riderWithBalance()]);
    const manager = {
      findOne: jest.fn(async (entity: unknown) =>
        entity === Wallets ? { id: 'wallet-1', walletBalance: 0 } : undefined,
      ),
      create: jest.fn(),
      save: jest.fn(),
      decrement: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn(async (work: (value: typeof manager) => unknown) =>
        work(manager),
      ),
    };
    const paystack = {
      assertConfigured: jest.fn(),
      initiateBulkTransfer: jest.fn(),
    };
    const service = createService({
      payoutRepo: { findOne: jest.fn(async () => undefined) },
      riderRepo: { createQueryBuilder: jest.fn(() => queryBuilder) },
      dataSource,
      paystack,
    });

    const response = (
      await service.runRiderPayouts({ isManual: true })
    ).toJSON();

    expect(response.message).toBe('NO_ELIGIBLE_PAYOUTS');
    expect(manager.create).not.toHaveBeenCalled();
    expect(manager.decrement).not.toHaveBeenCalled();
    expect(paystack.initiateBulkTransfer).not.toHaveBeenCalled();
  });
});

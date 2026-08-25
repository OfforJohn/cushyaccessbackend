import { BadRequestException } from '@nestjs/common';
import { ManualFunding } from '../model/manual-funding.entity';
import { Wallets } from '../model/wallet.entity';
import { Users } from 'src/users/model/users.entity';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { WalletService } from './wallet.service';

describe('WalletService.createBulkManualAdjustment', () => {
  const admin = { id: 'admin_1', firstName: 'Ada', lastName: 'Min' };

  const makeService = (wallets: Array<Partial<Wallets>>) => {
    const users = wallets.map((wallet) => ({
      id: wallet.userId,
      email: `${wallet.userId}@example.com`,
      firstName: String(wallet.userId),
      userRole: UserRoles.CUSTOMER,
    }));
    const queryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(wallets),
    };
    const manager = {
      find: jest.fn(async (entity: unknown) => (entity === Users ? users : [])),
      getRepository: jest.fn(() => ({
        createQueryBuilder: () => queryBuilder,
      })),
      create: jest.fn((_entity: unknown, values: object) => ({ ...values })),
      save: jest.fn(async (_entity: unknown, values: unknown) => values),
    };
    const dataSource = {
      transaction: jest.fn(
        async (callback: (value: typeof manager) => unknown) =>
          callback(manager),
      ),
    };
    const mailSender = { sendMail: jest.fn().mockResolvedValue(undefined) };
    const service = new WalletService(
      {} as never,
      {} as never,
      {} as never,
      { getLoggedInUser: jest.fn().mockResolvedValue(admin) } as never,
      dataSource as never,
      mailSender as never,
      {} as never,
    );

    return { service, manager, queryBuilder, mailSender, dataSource };
  };

  it('credits every selected wallet under a deterministic lock order', async () => {
    const walletB = { id: 'wallet_b', userId: 'user_b', walletBalance: 10 };
    const walletA = { id: 'wallet_a', userId: 'user_a', walletBalance: 25 };
    const { service, manager, queryBuilder } = makeService([walletA, walletB]);

    const response = await service.createBulkManualAdjustment({
      userIds: ['user_b', 'user_a'],
      type: 'credit',
      amount: 100,
      description: ' Production correction ',
    });

    expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'wallet.userId IN (:...userIds)',
      { userIds: ['user_a', 'user_b'] },
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('wallet.userId', 'ASC');
    expect(walletA.walletBalance).toBe(125);
    expect(walletB.walletBalance).toBe(110);
    const records = manager.save.mock.calls.find(
      ([entity]) => entity === ManualFunding,
    )?.[1] as Array<Partial<ManualFunding>>;
    expect(records).toHaveLength(2);
    expect(
      records.every((record) => record.description === 'Production correction'),
    ).toBe(true);
    expect(response.toJSON().data).toEqual(
      expect.objectContaining({
        processedCount: 2,
        skippedCount: 0,
        totalAmount: 200,
      }),
    );
  });

  it('debits each full balance and skips wallets that are already empty', async () => {
    const funded = { id: 'wallet_a', userId: 'user_a', walletBalance: 125.5 };
    const empty = { id: 'wallet_b', userId: 'user_b', walletBalance: 0 };
    const { service, manager } = makeService([funded, empty]);

    const response = await service.createBulkManualAdjustment({
      userIds: ['user_a', 'user_b'],
      type: 'debit',
      debitAll: true,
      description: 'Close balances',
    });

    expect(funded.walletBalance).toBe(0);
    expect(empty.walletBalance).toBe(0);
    const records = manager.save.mock.calls.find(
      ([entity]) => entity === ManualFunding,
    )?.[1] as Array<Partial<ManualFunding>>;
    expect(records).toHaveLength(1);
    expect(records[0].amount).toBe(-125.5);
    expect(response.toJSON().data).toEqual(
      expect.objectContaining({
        processedCount: 1,
        skippedCount: 1,
        totalAmount: 125.5,
      }),
    );
  });

  it('rejects the whole fixed-debit batch before saving when one wallet is underfunded', async () => {
    const { service, manager } = makeService([
      { id: 'wallet_a', userId: 'user_a', walletBalance: 500 },
      { id: 'wallet_b', userId: 'user_b', walletBalance: 50 },
    ]);

    await expect(
      service.createBulkManualAdjustment({
        userIds: ['user_a', 'user_b'],
        type: 'debit',
        amount: 100,
        description: 'Correction',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects IDs that only become duplicates after normalization', async () => {
    const { service, dataSource } = makeService([]);

    await expect(
      service.createBulkManualAdjustment({
        userIds: ['user_a', ' user_a '],
        type: 'credit',
        amount: 100,
        description: 'Correction',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});

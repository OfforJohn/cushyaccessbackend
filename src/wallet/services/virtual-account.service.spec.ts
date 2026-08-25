import { BadGatewayException } from '@nestjs/common';
import { VirtualAccounts } from '../model/virtual-account.entity';
import { VirtualAccountsService } from './virtual-account.service';

describe('VirtualAccountsService', () => {
  const dto = {
    userId: 'user_1',
    walletId: 'wallet_1',
    email: 'rider@test.dev',
    mobile: '08000000000',
    callingCode: '234',
    firstName: 'Test',
    lastName: 'Rider',
  };

  const createService = (existing: VirtualAccounts | null = null) => {
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn(async (_entity, value) => value),
    };
    const repository = {
      manager: {
        transaction: jest.fn(async (operation) => operation(manager)),
      },
    };
    const paystack = {
      getOrCreateCustomer: jest
        .fn()
        .mockResolvedValue({ customer_code: 'CUS_1' }),
      createDedicatedAccount: jest.fn().mockResolvedValue({
        account_name: 'Test Rider',
        account_number: '0123456789',
        bank: { name: 'Paystack-Titan' },
      }),
    };
    return {
      service: new VirtualAccountsService(
        repository as never,
        paystack as never,
      ),
      manager,
      paystack,
    };
  };

  it('serializes provisioning and persists a complete provider response', async () => {
    const { service, manager, paystack } = createService();

    const account = await service.createVirtualAccount(dto);

    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['virtual-account:wallet_1'],
    );
    expect(paystack.getOrCreateCustomer).toHaveBeenCalledWith(
      dto.email,
      dto.firstName,
      dto.lastName,
      '+2348000000000',
    );
    expect(paystack.createDedicatedAccount).toHaveBeenCalledWith(
      'CUS_1',
      dto.firstName,
      dto.lastName,
      '+2348000000000',
    );
    expect(account).toMatchObject({
      walletId: dto.walletId,
      accountName: 'Test Rider',
      accountNumber: '0123456789',
      bank: 'Paystack-Titan',
    });
  });

  it('returns an existing account without calling Paystack again', async () => {
    const existing = {
      id: 'va_existing',
      walletId: dto.walletId,
    } as VirtualAccounts;
    const { service, paystack } = createService(existing);

    await expect(service.createVirtualAccount(dto)).resolves.toBe(existing);
    expect(paystack.getOrCreateCustomer).not.toHaveBeenCalled();
    expect(paystack.createDedicatedAccount).not.toHaveBeenCalled();
  });

  it('recovers a dedicated account already created at Paystack', async () => {
    const { service, paystack } = createService();
    paystack.getOrCreateCustomer.mockResolvedValue({
      customer_code: 'CUS_1',
      dedicated_account: {
        account_name: 'Recovered Rider',
        account_number: '9876543210',
        bank: { name: 'Wema Bank' },
      },
    });

    const account = await service.createVirtualAccount(dto);

    expect(paystack.createDedicatedAccount).not.toHaveBeenCalled();
    expect(account).toMatchObject({
      accountName: 'Recovered Rider',
      accountNumber: '9876543210',
      bank: 'Wema Bank',
    });
  });

  it('does not persist an incomplete provider response', async () => {
    const { service, manager, paystack } = createService();
    paystack.createDedicatedAccount.mockResolvedValue({
      account_name: 'Test Rider',
      account_number: undefined,
      bank: { name: 'Paystack-Titan' },
    });

    await expect(service.createVirtualAccount(dto)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });
});

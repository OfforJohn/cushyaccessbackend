import { WalletService } from './wallet.service';

describe('WalletService initialization', () => {
  it('creates a customer wallet with a zero opening balance', async () => {
    const walletRepository = {
      save: jest.fn(async (wallet) => wallet),
    };
    const commonService = {
      getLoggedInUser: jest.fn().mockResolvedValue({
        id: 'customer_1',
        userRole: 'CUSTOMER',
      }),
    };
    const service = new WalletService(
      walletRepository as never,
      {} as never,
      {} as never,
      commonService as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const wallet = await service.createWallet();

    expect(walletRepository.save).toHaveBeenCalledTimes(1);
    expect(wallet).toMatchObject({
      userId: 'customer_1',
      walletBalance: 0,
      hasSetPin: false,
    });
  });
});

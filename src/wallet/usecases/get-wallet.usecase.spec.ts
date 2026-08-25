import { GetWalletUsecase } from './get-wallet.usecase';

describe('GetWalletUsecase', () => {
  const user = {
    id: 'user_1',
    email: 'rider@test.dev',
    mobile: '08000000000',
    callingCode: '234',
    firstName: 'Test',
    lastName: 'Rider',
  };

  const createUseCase = (wallet: any) => {
    const walletService = {
      getWallet: jest.fn().mockResolvedValue(wallet),
      createWallet: jest.fn().mockResolvedValue({
        id: 'wallet_new',
        userId: user.id,
        walletBalance: 0,
        hasSetPin: false,
      }),
    };
    const transactionService = {
      getLastTransctionsWithLimit: jest.fn().mockResolvedValue([]),
    };
    const commonService = {
      getLoggedInUser: jest.fn().mockResolvedValue(user),
    };
    const riderEarningsRecoveryService = {
      reconcileForUser: jest.fn().mockResolvedValue(0),
    };
    return {
      useCase: new GetWalletUsecase(
        walletService as never,
        transactionService as never,
        commonService as never,
        riderEarningsRecoveryService as never,
      ),
      walletService,
      riderEarningsRecoveryService,
    };
  };

  it('returns an existing wallet as a successful response', async () => {
    const { useCase, riderEarningsRecoveryService } = createUseCase({
      id: 'wallet_1',
      userId: user.id,
      walletBalance: 100,
      hasSetPin: true,
    });

    const response = await useCase.execute();

    expect(response.toJSON()).toMatchObject({
      error: false,
      message: 'WALLET_FETCHED_SUCCESSFULLY',
      data: { id: 'wallet_1', accountBalance: 100 },
    });
    expect(riderEarningsRecoveryService.reconcileForUser).toHaveBeenCalledWith(
      user.id,
    );
  });

  it('creates a wallet without eagerly allocating a bank account', async () => {
    const { useCase, walletService } = createUseCase(null);
    const response = await useCase.execute();

    expect(response.toJSON()).toMatchObject({
      error: false,
      data: { id: 'wallet_new', accountBalance: 0 },
    });
    expect(walletService.createWallet).toHaveBeenCalledTimes(1);
  });
});

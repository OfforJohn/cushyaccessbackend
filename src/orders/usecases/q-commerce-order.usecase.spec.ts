import { QCommerceOrderUseCase } from './q-commerce-order.usecase';

describe('QCommerceOrderUseCase current cart snapshot', () => {
  it('recalculates cart pricing before resolving the store or charging', async () => {
    const cart = { cartItems: [{ id: 'item_1' }] };
    const cartService = {
      getCart: jest.fn().mockResolvedValue(cart),
      calculateCartAmounts: jest.fn().mockResolvedValue(cart),
    };
    const storeService = {
      assertStoreCanAcceptOrders: jest
        .fn()
        .mockRejectedValue(new Error('stop after recalculation')),
    };
    const useCase = new QCommerceOrderUseCase(
      storeService as any,
      cartService as any,
      {
        getLoggedInUser: jest.fn().mockResolvedValue({ id: 'usr_1' }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(useCase.execute({} as any)).rejects.toThrow(
      'stop after recalculation',
    );
    expect(cartService.calculateCartAmounts).toHaveBeenCalledWith(
      cart,
      undefined,
      true,
    );
    expect(
      cartService.calculateCartAmounts.mock.invocationCallOrder[0],
    ).toBeLessThan(
      storeService.assertStoreCanAcceptOrders.mock.invocationCallOrder[0],
    );
  });
});

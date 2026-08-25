import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService permanent account deletion', () => {
  const createService = (loggedInUser: Record<string, unknown>) => {
    const commonService = {
      getLoggedInUser: jest.fn().mockResolvedValue(loggedInUser),
    };
    const deletionUseCase = {
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      commonService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      deletionUseCase as never,
    );
    return { service, deletionUseCase };
  };

  it('uses the complete hard-delete transaction for the authenticated user', async () => {
    const { service, deletionUseCase } = createService({
      id: 'customer_1',
      email: 'customer@example.com',
    });

    const response = await service.deleteUser();

    expect(deletionUseCase.execute).toHaveBeenCalledWith(
      'customer_1',
      'customer@example.com',
    );
    expect(response.toJSON().message).toBe('USER_PERMANENTLY_DELETED');
  });

  it('does not claim deletion for an invalid authenticated session', async () => {
    const { service, deletionUseCase } = createService({});

    await expect(service.deleteUser()).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deletionUseCase.execute).not.toHaveBeenCalled();
  });
});

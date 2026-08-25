import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard session revocation', () => {
  const createContext = () => {
    const request = {
      headers: { 'cushy-access-key': 'Bearer token' },
      user: undefined,
    };
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as never;
    return { context, request };
  };

  const createGuard = (tokenVersion: number, storedVersion: number) =>
    new JwtAuthGuard(
      {
        verifyAsync: jest.fn().mockResolvedValue({
          userId: 'user_1',
          sessionVersion: tokenVersion,
        }),
      } as never,
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as never,
      { get: jest.fn().mockReturnValue('secret') } as never,
      {
        findAuthUserById: jest.fn().mockResolvedValue({
          id: 'user_1',
          email: 'person@example.com',
          mobile: '8012345678',
          firstName: 'Test',
          lastName: 'User',
          userRole: 'CUSTOMER',
          adminRole: 'SUPER_ADMIN',
          sessionVersion: storedVersion,
        }),
      } as never,
    );

  it('accepts a token with the current session version', async () => {
    const { context, request } = createContext();
    await expect(createGuard(2, 2).canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(
      expect.objectContaining({ adminRole: 'SUPER_ADMIN' }),
    );
  });

  it('rejects a token issued before the password reset', async () => {
    await expect(
      createGuard(1, 2).canActivate(createContext().context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

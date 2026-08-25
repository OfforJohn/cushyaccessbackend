import { WsException } from '@nestjs/websockets';
import { WsJwtGuard } from './ws-jwt.guard';

describe('WsJwtGuard account and session validation', () => {
  const createContext = () => {
    const client = {
      id: 'socket_1',
      data: {},
      handshake: {
        auth: { token: 'token' },
        query: {},
        headers: {},
      },
    };
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToWs: () => ({ getClient: () => client }),
    } as never;
    return { context, client };
  };

  const createGuard = (user: Record<string, unknown> | undefined) =>
    new WsJwtGuard(
      {
        verifyAsync: jest.fn().mockResolvedValue({
          userId: 'user_1',
          sessionVersion: 3,
        }),
      } as never,
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as never,
      { get: jest.fn().mockReturnValue('secret') } as never,
      { findAuthUserById: jest.fn().mockResolvedValue(user) } as never,
    );

  it('authenticates against the uncached current user record', async () => {
    const { context, client } = createContext();
    await expect(
      createGuard({
        id: 'user_1',
        email: 'person@example.com',
        mobile: '8012345678',
        firstName: 'Test',
        lastName: 'User',
        userRole: 'CUSTOMER',
        sessionVersion: 3,
      }).canActivate(context),
    ).resolves.toBe(true);
    expect(client.data).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({ id: 'user_1' }),
      }),
    );
  });

  it('rejects a token after its account row has been deleted', async () => {
    await expect(
      createGuard(undefined).canActivate(createContext().context),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('rejects a revoked websocket session', async () => {
    await expect(
      createGuard({
        id: 'user_1',
        userRole: 'CUSTOMER',
        sessionVersion: 4,
      }).canActivate(createContext().context),
    ).rejects.toBeInstanceOf(WsException);
  });
});

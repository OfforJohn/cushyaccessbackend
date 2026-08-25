import { ConsultationGateway } from './consultation.gateway';
import { UserRoles } from '../../users/model/user-roles.enum';

describe('ConsultationGateway authentication', () => {
  const createGateway = (user: Record<string, unknown> | null) => {
    const gateway = new ConsultationGateway(
      { setServer: jest.fn() } as never,
      {} as never,
      {
        verify: jest.fn().mockReturnValue({
          userId: 'doctor_1',
          role: 'DOCTOR',
          sessionVersion: 2,
        }),
      } as never,
      {
        getRepository: jest.fn(() => ({
          findOne: jest.fn().mockResolvedValue(user),
        })),
      } as never,
    );
    return gateway;
  };

  const createClient = () => ({
    id: 'socket_1',
    data: {},
    handshake: {
      auth: { token: 'token' },
      headers: {},
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
    join: jest.fn(),
  });

  it('rejects reconnects from a deleted account', async () => {
    const client = createClient();
    await createGateway(null).handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('prevents a socket from registering another doctor identity', async () => {
    const client = createClient();
    const gateway = createGateway({
      id: 'doctor_1',
      email: 'doctor@example.com',
      mobile: '8012345678',
      userRole: UserRoles.DOCTOR,
      sessionVersion: 2,
    });
    await gateway.handleConnection(client as never);

    await expect(
      gateway.handleRegisterDoctor({ doctorId: 'doctor_2' }, client as never),
    ).resolves.toEqual({
      event: 'error',
      data: { message: 'Unauthorized' },
    });
    expect(client.join).not.toHaveBeenCalled();
  });

  it('registers only the authenticated doctor identity', async () => {
    const client = createClient();
    const gateway = createGateway({
      id: 'doctor_1',
      email: 'doctor@example.com',
      mobile: '8012345678',
      userRole: UserRoles.DOCTOR,
      sessionVersion: 2,
    });
    await gateway.handleConnection(client as never);

    await expect(
      gateway.handleRegisterDoctor({ doctorId: 'doctor_1' }, client as never),
    ).resolves.toEqual(
      expect.objectContaining({
        event: 'registered',
      }),
    );
    expect(client.join).toHaveBeenCalledWith('doctor:doctor_1');
  });

  it('rejects an event when the account is deleted after connecting', async () => {
    const client = createClient();
    const findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'doctor_1',
        email: 'doctor@example.com',
        mobile: '8012345678',
        userRole: UserRoles.DOCTOR,
        sessionVersion: 2,
      })
      .mockResolvedValueOnce(null);
    const gateway = new ConsultationGateway(
      { setServer: jest.fn() } as never,
      {} as never,
      {
        verify: jest.fn().mockReturnValue({
          userId: 'doctor_1',
          role: 'DOCTOR',
          sessionVersion: 2,
        }),
      } as never,
      {
        getRepository: jest.fn(() => ({ findOne })),
      } as never,
    );

    await gateway.handleConnection(client as never);
    await expect(
      gateway.handleRegisterDoctor({ doctorId: 'doctor_1' }, client as never),
    ).resolves.toEqual({
      event: 'error',
      data: { message: 'Unauthorized' },
    });
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });
});

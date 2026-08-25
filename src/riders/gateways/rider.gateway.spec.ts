import { Orders } from '../../orders/model/order.entity';
import { RiderGateway } from './rider.gateway';
import { DataSource } from 'typeorm';
import { RiderConnectionService } from '../services/rider-connection.service';
import { JwtService } from '@nestjs/jwt';
import { Users } from '../../users/model/users.entity';

describe('RiderGateway public order payload', () => {
  it('includes the authoritative gross, commission, and net rider amounts', () => {
    const gateway = Object.create(RiderGateway.prototype) as RiderGateway;
    const payload = gateway.mapOrderResponsePublic({
      id: 'ord_realtime',
      status: 'PENDING',
      type: 'q_commerce',
      totalItems: 2,
      totalAmount: 4050,
      orderTracking: [],
      orderItems: [],
      orderCharges: {
        chargeNodes: [{ name: 'deliveryFee', amount: 1000 }],
      },
      createdAt: new Date('2026-08-01T12:00:00.000Z'),
    } as unknown as Orders);

    expect(payload).toMatchObject({
      isAvailable: true,
      deliveryFee: 1000,
      riderCommission: 200,
      riderCommissionRate: 0.2,
      riderPayout: 800,
    });
  });

  it('marks a merchant-acknowledged but unassigned realtime order as available', () => {
    const gateway = Object.create(RiderGateway.prototype) as RiderGateway;
    const payload = gateway.mapOrderResponsePublic({
      id: 'ord_available',
      status: 'PENDING',
      riderId: null,
      type: 'q_commerce',
      orderTracking: [
        {
          orderStatus: 'ACKNOWLEDGED',
          createdAt: new Date('2026-08-08T10:00:00.000Z'),
        },
      ],
      orderItems: [],
      createdAt: new Date('2026-08-08T09:59:00.000Z'),
    } as unknown as Orders);

    expect(payload).toMatchObject({
      status: 'ACKNOWLEDGED',
      riderId: null,
      isAvailable: true,
    });
  });

  it('does not infer rider earnings from unrelated order charges', () => {
    const gateway = Object.create(RiderGateway.prototype) as RiderGateway;
    const payload = gateway.mapOrderResponsePublic({
      id: 'ord_without_delivery_fee',
      status: 'PENDING',
      type: 'q_commerce',
      totalItems: 1,
      totalAmount: 2000,
      orderTracking: [],
      orderItems: [],
      orderCharges: {
        chargeNodes: [{ name: 'serviceFee', amount: 500 }],
      },
      createdAt: new Date('2026-08-01T12:00:00.000Z'),
    } as unknown as Orders);

    expect(payload).toMatchObject({
      deliveryFee: 0,
      riderCommission: 0,
      riderPayout: 0,
    });
  });

  it('publishes new orders to a cross-process stable user room', () => {
    const gateway = Object.create(RiderGateway.prototype) as RiderGateway;
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    (gateway as any).server = { to };

    expect(gateway.notifyNewOrder('user_1', { id: 'ord_1' })).toBe(true);
    expect(to).toHaveBeenCalledWith('authenticated-user:user_1');
    expect(emit).toHaveBeenCalledWith('order:new_available', {
      id: 'ord_1',
    });
  });
});

describe('RiderGateway location refresh', () => {
  it('uses a PostgreSQL-safe distance alias for available-order refreshes', async () => {
    const queryBuilder: Record<string, jest.Mock> = {};
    [
      'leftJoinAndSelect',
      'where',
      'andWhere',
      'addSelect',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
    ].forEach((method) => {
      queryBuilder[method] = jest.fn(() => queryBuilder);
    });
    queryBuilder.getMany = jest.fn().mockResolvedValue([]);

    const ordersRepository = {
      exists: jest.fn().mockResolvedValue(false),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    const riderRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'rider_1',
        userId: 'user_1',
        isOnline: true,
        status: 'active',
        trainingCompleted: true,
        backgroundCheckStatus: 'approved',
        currentLatitude: 9.0153312,
        currentLongitude: 7.568101,
        lastLocationUpdate: new Date(),
      }),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Orders ? ordersRepository : riderRepository,
      ),
    };
    const moduleRef = {
      get: jest.fn((token: unknown) =>
        token === DataSource ? dataSource : null,
      ),
    };
    const gateway = new RiderGateway(moduleRef as never);

    const result = await (gateway as any).getAvailableOrdersDirect(
      50,
      1,
      'user_1',
      'rider_1',
    );

    expect(result).toEqual([]);
    expect(queryBuilder.addSelect).toHaveBeenCalledWith(
      expect.any(String),
      'pickup_distance',
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('pickup_distance', 'ASC');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'order.status IN (:...claimableStatuses)',
      {
        claimableStatuses: ['PENDING', 'ACKNOWLEDGED'],
      },
    );
    expect(ordersRepository.exists).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({
            riderId: 'rider_1',
            cancelledAt: expect.anything(),
            deliveredAt: expect.anything(),
            rejectedAt: expect.anything(),
          }),
        ]),
      }),
    );
  });

  it('surfaces availability query failures instead of disguising them as no orders', async () => {
    const queryBuilder: Record<string, jest.Mock> = {};
    [
      'leftJoinAndSelect',
      'where',
      'andWhere',
      'addSelect',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
    ].forEach((method) => {
      queryBuilder[method] = jest.fn(() => queryBuilder);
    });
    queryBuilder.getMany = jest
      .fn()
      .mockRejectedValue(new Error('availability query failed'));
    const dataSource = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Orders
          ? {
              exists: jest.fn().mockResolvedValue(false),
              createQueryBuilder: jest.fn(() => queryBuilder),
            }
          : {
              findOne: jest.fn().mockResolvedValue({
                id: 'rider_1',
                userId: 'user_1',
                isOnline: true,
                status: 'active',
                trainingCompleted: true,
                backgroundCheckStatus: 'approved',
                currentLatitude: 9.0153312,
                currentLongitude: 7.568101,
                lastLocationUpdate: new Date(),
              }),
            },
      ),
    };
    const gateway = new RiderGateway({
      get: jest.fn((token: unknown) =>
        token === DataSource ? dataSource : null,
      ),
    } as never);

    await expect(
      (gateway as any).getAvailableOrdersDirect(50, 1, 'user_1', 'rider_1'),
    ).rejects.toThrow('availability query failed');
  });

  it('refreshes available orders immediately after the first persisted location', async () => {
    const connections = {
      getUserIdBySocketId: jest.fn().mockReturnValue('user_1'),
      getRiderIdBySocketId: jest.fn().mockReturnValue('rider_1'),
      getRoleBySocketId: jest.fn().mockReturnValue('RIDER'),
      updateLocation: jest.fn(),
    };
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const dataSource = { getRepository: jest.fn(() => ({ update })) };
    const moduleRef = {
      get: jest.fn((token: unknown) => {
        if (token === RiderConnectionService) return connections;
        if (token === DataSource) return dataSource;
        return null;
      }),
    };
    const gateway = new RiderGateway(moduleRef as never);
    const room = { emit: jest.fn() };
    (gateway as any).server = { to: jest.fn(() => room) };
    jest
      .spyOn(gateway as any, 'getAvailableOrdersDirect')
      .mockResolvedValue([{ id: 'ord_1' }]);
    const client = { id: 'socket_1', emit: jest.fn() };

    await gateway.handleUpdateLocation(client as never, {
      latitude: 9.0153312,
      longitude: 7.568101,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rider_1' }),
      expect.objectContaining({
        currentLatitude: 9.0153312,
        currentLongitude: 7.568101,
      }),
    );
    expect(client.emit).toHaveBeenCalledWith(
      'rider:new-orders-available',
      expect.objectContaining({ orders: [{ id: 'ord_1' }], count: 1 }),
    );
    expect((gateway as any).server.to).toHaveBeenCalledWith(
      'rider-room-rider_1',
    );
    expect(room.emit).toHaveBeenCalledWith(
      'rider:location-updated',
      expect.objectContaining({
        riderId: 'rider_1',
        location: expect.objectContaining({
          latitude: 9.0153312,
          longitude: 7.568101,
        }),
      }),
    );
  });

  it('starts customer tracking from the rider persisted GPS location', async () => {
    const updatedAt = new Date();
    const rider = {
      id: 'rider_1',
      userId: 'rider_user_1',
      isOnline: true,
      currentLatitude: 9.0153312,
      currentLongitude: 7.568101,
      lastLocationUpdate: updatedAt,
      user: {
        firstName: 'John',
        lastName: 'Doe',
        mobile: '+2348000000000',
      },
    };
    const connections = {
      getUserIdBySocketId: jest.fn().mockReturnValue('customer_1'),
      getRoleBySocketId: jest.fn().mockReturnValue('CUSTOMER'),
      linkUserAndRider: jest.fn(),
      getLocation: jest.fn(),
      isRiderOnline: jest.fn().mockReturnValue(false),
    };
    const findOne = jest.fn().mockResolvedValue({
      id: 'order_1',
      userId: 'customer_1',
      rider,
    });
    const dataSource = { getRepository: jest.fn(() => ({ findOne })) };
    const moduleRef = {
      get: jest.fn((token: unknown) => {
        if (token === RiderConnectionService) return connections;
        if (token === DataSource) return dataSource;
        return null;
      }),
    };
    const gateway = new RiderGateway(moduleRef as never);
    const client = {
      id: 'customer_socket_1',
      join: jest.fn(),
      emit: jest.fn(),
    };

    const result = await gateway.handleCustomerStartTracking(client as never, {
      riderId: 'rider_1',
      orderId: 'order_1',
    });

    expect(client.join).toHaveBeenCalledWith('rider-room-rider_1');
    expect(client.join).toHaveBeenCalledWith('rider-room-rider_user_1');
    expect(client.emit).toHaveBeenCalledWith(
      'customer:tracking-started',
      expect.objectContaining({
        riderInfo: expect.objectContaining({
          name: 'John Doe',
          isOnline: true,
        }),
        currentLocation: {
          latitude: 9.0153312,
          longitude: 7.568101,
          speed: undefined,
          heading: undefined,
          accuracy: undefined,
          updatedAt: updatedAt.toISOString(),
        },
      }),
    );
    expect(result).toMatchObject({ status: 'success' });
  });

  it('does not make an unchanged GPS coordinate look fresh on heartbeat', () => {
    const updatedAt = new Date('2026-08-07T09:58:00.000Z');
    const connections = {
      getLocation: jest.fn().mockReturnValue({
        latitude: 9.0153312,
        longitude: 7.568101,
        updatedAt,
      }),
    };
    const moduleRef = {
      get: jest.fn((token: unknown) =>
        token === RiderConnectionService ? connections : null,
      ),
    };
    const gateway = new RiderGateway(moduleRef as never);
    const client = {
      rooms: new Set(['rider-room-rider_1']),
      emit: jest.fn(),
    };

    const result = gateway.handleRequestLiveLocation(client as never, {
      riderId: 'rider_1',
    });

    expect(client.emit).toHaveBeenCalledWith('rider:location-updated', {
      riderId: 'rider_1',
      location: expect.objectContaining({
        latitude: 9.0153312,
        longitude: 7.568101,
      }),
      timestamp: updatedAt.toISOString(),
    });
    expect(result).toEqual({ status: 'success' });
  });
});

describe('RiderGateway connection authentication', () => {
  it('accepts the standard Socket.IO auth token through the configured JwtService', async () => {
    const connections = {
      getSocketIdByUserId: jest.fn(),
      addConnection: jest.fn(),
    };
    const jwtService = {
      verify: jest.fn().mockReturnValue({
        userId: 'rider_user_1',
        role: 'RIDER',
        sessionVersion: 2,
      }),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => ({
        findOne: jest.fn().mockResolvedValue(
          entity === Users
            ? {
                id: 'rider_user_1',
                userRole: 'RIDER',
                sessionVersion: 2,
              }
            : { id: 'rider_1', userId: 'rider_user_1' },
        ),
      })),
    };
    const moduleRef = {
      get: jest.fn((token: unknown) => {
        if (token === RiderConnectionService) return connections;
        if (token === JwtService) return jwtService;
        if (token === DataSource) return dataSource;
        return null;
      }),
    };
    const gateway = new RiderGateway(moduleRef as never);
    (gateway as any).server = { sockets: { sockets: new Map() } };
    const client = {
      id: 'socket_1',
      handshake: {
        auth: { token: 'signed-login-token' },
        query: {},
        headers: {},
      },
      join: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    await gateway.handleConnection(client as never);

    expect(jwtService.verify).toHaveBeenCalledWith('signed-login-token');
    expect(connections.addConnection).toHaveBeenCalledWith(
      'socket_1',
      'rider_user_1',
      'RIDER',
      'rider_1',
    );
    expect(client.join).toHaveBeenCalledWith('authenticated-user:rider_user_1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('rejects a validly signed token after the user record is deleted', async () => {
    const connections = {
      getSocketIdByUserId: jest.fn(),
      addConnection: jest.fn(),
    };
    const dataSource = {
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(null),
      })),
    };
    const moduleRef = {
      get: jest.fn((token: unknown) => {
        if (token === RiderConnectionService) return connections;
        if (token === JwtService) {
          return {
            verify: jest.fn().mockReturnValue({
              userId: 'deleted_user',
              role: 'CUSTOMER',
              sessionVersion: 0,
            }),
          };
        }
        if (token === DataSource) return dataSource;
        return null;
      }),
    };
    const gateway = new RiderGateway(moduleRef as never);
    const client = {
      id: 'socket_deleted',
      handshake: {
        auth: { token: 'still-signed-token' },
        query: {},
        headers: {},
      },
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    await gateway.handleConnection(client as never);

    expect(connections.addConnection).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });
});

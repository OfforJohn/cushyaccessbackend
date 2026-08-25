/// <reference types="jest" />

import { UsersService } from './users.service';
import { UserRoles } from '../model/user-roles.enum';
import { BadRequestException } from '@nestjs/common';

describe('UsersService authentication lookup', () => {
  it('loads the live admin role used by the global authorization guard', async () => {
    const usersRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'admin-1',
        userRole: 'ADMIN',
        adminRole: 'SUPER_ADMIN',
      }),
    };
    const service = new UsersService(
      usersRepository as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.findAuthUserById('admin-1');

    expect(usersRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.arrayContaining(['userRole', 'adminRole']),
      }),
    );
  });

  it('uses a valid non-reserved alias for the normalized phone fallback', async () => {
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const usersRepository = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const service = new UsersService(
      usersRepository as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.findByEmailOrMobile('+234 801 234 5678');

    expect(usersRepository.createQueryBuilder).toHaveBeenCalledWith(
      'candidate_user',
    );
    const sql = queryBuilder.where.mock.calls[0][0] as string;
    expect(sql).toContain('candidate_user."mobile"');
    expect(sql).not.toMatch(/\buser\./);
    expect(sql.trim().startsWith('(')).toBe(true);
    expect(sql.trim().endsWith(')')).toBe(true);
  });

  it('serializes email and phone identities inside the caller transaction', async () => {
    const repository = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (user) => Object.assign(user, { id: 'usr_1' })),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(repository),
      query: jest.fn().mockResolvedValue([]),
    };
    const usersRepository = {
      manager: { transaction: jest.fn() },
    };
    const service = new UsersService(
      usersRepository as never,
      {} as never,
      { setItemInCache: jest.fn() } as never,
      { publish: jest.fn() } as never,
    );
    jest
      .spyOn(service as never, 'hashPassword' as never)
      .mockResolvedValue('hashed-password' as never);

    const user = await service.registerUser(
      {
        firstName: 'Ada',
        lastName: 'Rider',
        username: 'ada-rider',
        email: ' ADA@EXAMPLE.COM ',
        mobile: '08012345678',
        callingCode: '+234',
        countryCode: 'NG',
        password: 'secret123',
      },
      UserRoles.RIDER,
      undefined,
      manager as never,
    );

    expect(user).toMatchObject({
      id: 'usr_1',
      email: 'ada@example.com',
      mobile: '8012345678',
    });
    const lockKeys = manager.query.mock.calls.map((call) => call[1][0]);
    expect(lockKeys).toEqual([...lockKeys].sort());
    expect(lockKeys).toEqual(
      expect.arrayContaining([
        'user-email:ada@example.com',
        'user-phone:2348012345678',
      ]),
    );
    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(usersRepository.manager.transaction).not.toHaveBeenCalled();
  });

  it('allows the same national number under different calling codes', async () => {
    const repository = {
      find: jest.fn().mockResolvedValue([
        {
          email: 'india@example.com',
          mobile: '7400123456',
          callingCode: '91',
          countryCode: 'IN',
        },
      ]),
      save: jest.fn(async (user) => Object.assign(user, { id: 'usr_gb' })),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(repository),
      query: jest.fn().mockResolvedValue([]),
    };
    const service = new UsersService(
      {} as never,
      {} as never,
      { setItemInCache: jest.fn() } as never,
      { publish: jest.fn() } as never,
    );
    jest
      .spyOn(service as never, 'hashPassword' as never)
      .mockResolvedValue('hashed-password' as never);

    await expect(
      service.registerUser(
        {
          firstName: 'Ada',
          lastName: 'Britain',
          username: 'ada-gb',
          email: 'ada@example.co.uk',
          mobile: '7400123456',
          callingCode: '44',
          countryCode: 'GB',
          password: 'secret123',
        },
        UserRoles.CUSTOMER,
        undefined,
        manager as never,
      ),
    ).resolves.toMatchObject({ id: 'usr_gb' });
  });

  it('rejects equivalent phone forms under the same calling code', async () => {
    const repository = {
      find: jest.fn().mockResolvedValue([
        {
          email: 'existing@example.com',
          mobile: '08012345678',
          callingCode: '234',
          countryCode: 'NG',
        },
      ]),
      save: jest.fn(),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(repository),
      query: jest.fn().mockResolvedValue([]),
    };
    const service = new UsersService(
      {} as never,
      {} as never,
      { setItemInCache: jest.fn() } as never,
      { publish: jest.fn() } as never,
    );
    jest
      .spyOn(service as never, 'hashPassword' as never)
      .mockResolvedValue('hashed-password' as never);

    await expect(
      service.registerUser(
        {
          firstName: 'Another',
          lastName: 'User',
          username: 'another-user',
          email: 'another@example.com',
          mobile: '8012345678',
          callingCode: '234',
          countryCode: 'NG',
          password: 'secret123',
        },
        UserRoles.CUSTOMER,
        undefined,
        manager as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
  });
});

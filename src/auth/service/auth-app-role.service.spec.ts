import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserRoles } from '../../users/model/user-roles.enum';

describe('AuthService app-specific login', () => {
  const createService = (role: UserRoles) => {
    const user = { id: 'user_1', userRole: role };
    const storeRepository = { find: jest.fn().mockResolvedValue([]) };
    const riderRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const userService = {
      findByEmailOrMobileWithRelation: jest.fn().mockResolvedValue(user),
    };
    const analyticsService = {
      trackUserActivity: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthService(
      {} as never,
      {} as never,
      {} as never,
      storeRepository as never,
      {} as never,
      riderRepository as never,
      userService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      analyticsService as never,
      {} as never,
    );
    jest.spyOn(service as any, 'validatePassword').mockResolvedValue({
      userDto: { id: user.id, userRole: role },
      auth: { access_token: 'token' },
    });
    return { service, storeRepository, riderRepository };
  };

  it.each(['login', 'loginMobileApp'] as const)(
    '%s rejects a rider account before loading consumer profile data',
    async (method) => {
      const { service, storeRepository, riderRepository } = createService(
        UserRoles.RIDER,
      );

      await expect(
        service[method]({
          emailOrMobile: 'rider@test.dev',
          password: 'secret',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(storeRepository.find).not.toHaveBeenCalled();
      expect(riderRepository.findOne).not.toHaveBeenCalled();
    },
  );

  it('rejects a customer account in the rider app', async () => {
    const { service } = createService(UserRoles.CUSTOMER);

    await expect(
      service.loginRiderApp({
        emailOrMobile: 'customer@test.dev',
        password: 'secret',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows a rider account in the rider app', async () => {
    const { service, riderRepository } = createService(UserRoles.RIDER);
    riderRepository.findOne.mockResolvedValue({
      id: 'rider_1',
      status: 'active',
      isOnline: true,
      lastLocationUpdate: new Date(),
      rating: 5,
      totalDeliveries: 0,
      totalEarnings: 0,
    });

    const response = await service.loginRiderApp({
      emailOrMobile: 'rider@test.dev',
      password: 'secret',
    });

    expect(response.toJSON()).toMatchObject({
      error: false,
      data: {
        access_token: 'token',
        riderId: 'rider_1',
        riderDetails: { id: 'rider_1', status: 'active' },
      },
    });
    expect(riderRepository.update).toHaveBeenCalledWith(
      { id: 'rider_1', userId: 'user_1' },
      { isOnline: false, lastLocationUpdate: null },
    );
    expect(response.toJSON()).toMatchObject({
      data: { riderDetails: { isOnline: false } },
    });
  });
});

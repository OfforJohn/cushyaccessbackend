/// <reference types="jest" />

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ADMIN_ROLE_KEY } from 'src/auth/service/admin-roles.decorator';
import { AdminRole } from 'src/users/model/admin-roles.enum';
import { WalletController } from './wallet.controller';

describe('WalletController rider payout administration', () => {
  const payoutService = {
    runRiderPayouts: jest.fn(),
    getRiderPayouts: jest.fn(),
    getRiderPayoutStats: jest.fn(),
  };
  const controller = new WalletController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    payoutService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['runRiderPayouts', 'run-rider-payouts', RequestMethod.POST],
    ['getAllRiderPayouts', 'riders/payouts', RequestMethod.GET],
    ['getRiderPayoutStats', 'riders/payouts/stats', RequestMethod.GET],
  ] as const)(
    'protects %s with finance roles and the expected route',
    (methodName, path, requestMethod) => {
      const handler = WalletController.prototype[methodName];

      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(requestMethod);
      expect(Reflect.getMetadata(ADMIN_ROLE_KEY, handler)).toEqual([
        AdminRole.SUPER_ADMIN,
        AdminRole.ACCOUNTANT,
      ]);
    },
  );

  it('forces an admin run through the existing manual rider settlement path', async () => {
    payoutService.runRiderPayouts.mockResolvedValue({ ok: true });

    await controller.runRiderPayouts();

    expect(payoutService.runRiderPayouts).toHaveBeenCalledWith({
      isManual: true,
    });
  });

  it('delegates rider list filters and stats to rider-scoped service methods', async () => {
    const filters = {
      page: 2,
      limit: 25,
      sortBy: 'createdAt' as const,
      sortOrder: 'DESC' as const,
    };
    payoutService.getRiderPayouts.mockResolvedValue({ ok: true });
    payoutService.getRiderPayoutStats.mockResolvedValue({ ok: true });

    await controller.getAllRiderPayouts(filters);
    await controller.getRiderPayoutStats();

    expect(payoutService.getRiderPayouts).toHaveBeenCalledWith(filters);
    expect(payoutService.getRiderPayoutStats).toHaveBeenCalledTimes(1);
  });
});

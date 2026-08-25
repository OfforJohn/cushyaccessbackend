/// <reference types="jest" />

import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from 'src/users/model/admin-roles.enum';
import { ADMIN_ROLE_KEY } from './admin-roles.decorator';
import { AdminRoleGuard } from './admin-roles.guard';
import { IS_PUBLIC_JEY } from './public.decorator';

describe('AdminRoleGuard', () => {
  const context = (adminRole?: AdminRole) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user: { adminRole } }) }),
    }) as unknown as ExecutionContext;

  const guard = (roles?: AdminRole[], isPublic = false) => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === IS_PUBLIC_JEY) return isPublic;
        if (key === ADMIN_ROLE_KEY) return roles;
        return undefined;
      }),
    } as unknown as Reflector;
    return new AdminRoleGuard(reflector);
  };

  it('allows configured finance roles', () => {
    expect(
      guard([AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT]).canActivate(
        context(AdminRole.ACCOUNTANT),
      ),
    ).toBe(true);
  });

  it('denies another admin sub-role', () => {
    expect(
      guard([AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT]).canActivate(
        context(AdminRole.MARKETING),
      ),
    ).toBe(false);
  });

  it('denies an admin whose sub-role is missing', () => {
    expect(
      guard([AdminRole.SUPER_ADMIN, AdminRole.ACCOUNTANT]).canActivate(
        context(),
      ),
    ).toBe(false);
  });

  it('does not affect routes without admin-role metadata', () => {
    expect(guard().canActivate(context())).toBe(true);
  });
});

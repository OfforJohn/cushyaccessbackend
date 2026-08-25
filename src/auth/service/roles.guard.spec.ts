/// <reference types="jest" />

import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { IS_PUBLIC_JEY } from './public.decorator';
import { ROLE_KEY } from './roles.decorator';
import { RoleGuard } from './roles.guard';

describe('RoleGuard', () => {
  const createContext = (role?: UserRoles) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: role ? { role } : undefined }),
      }),
    }) as unknown as ExecutionContext;

  const createGuard = ({
    isPublic = false,
    roles,
  }: {
    isPublic?: boolean;
    roles?: UserRoles[];
  }) => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === IS_PUBLIC_JEY) return isPublic;
        if (key === ROLE_KEY) return roles;
        return undefined;
      }),
    } as unknown as Reflector;

    return new RoleGuard(reflector);
  };

  it('allows a user whose role is explicitly permitted', () => {
    const guard = createGuard({ roles: [UserRoles.ADMIN] });

    expect(guard.canActivate(createContext(UserRoles.ADMIN))).toBe(true);
  });

  it('rejects a user whose role is not permitted', () => {
    const guard = createGuard({ roles: [UserRoles.ADMIN] });

    expect(guard.canActivate(createContext(UserRoles.CUSTOMER))).toBe(false);
  });

  it('allows public routes without a user', () => {
    const guard = createGuard({
      isPublic: true,
      roles: [UserRoles.ADMIN],
    });

    expect(guard.canActivate(createContext())).toBe(true);
  });
});

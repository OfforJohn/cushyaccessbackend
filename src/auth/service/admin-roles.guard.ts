import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from 'src/users/model/admin-roles.enum';
import { IS_PUBLIC_JEY } from './public.decorator';
import { ADMIN_ROLE_KEY } from './admin-roles.decorator';

@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_JEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(
      ADMIN_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles?.length) return true;

    const adminRole = context.switchToHttp().getRequest()?.user?.adminRole;
    return requiredRoles.includes(adminRole);
  }
}

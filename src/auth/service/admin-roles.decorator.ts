import { SetMetadata } from '@nestjs/common';
import { AdminRole } from 'src/users/model/admin-roles.enum';

export const ADMIN_ROLE_KEY = 'ADMIN_ROLE_KEY';
export const PermitAdminRoles = (...roles: AdminRole[]) =>
  SetMetadata(ADMIN_ROLE_KEY, roles);

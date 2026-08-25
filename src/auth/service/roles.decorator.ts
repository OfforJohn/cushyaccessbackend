import { SetMetadata } from '@nestjs/common';
import { UserRoles } from 'src/users/model/user-roles.enum';

export const ROLE_KEY = 'ROLE_KEY';
export const Permit = (roles: UserRoles[]) => SetMetadata(ROLE_KEY, roles);

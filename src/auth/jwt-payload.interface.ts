import { UserRoles } from 'src/users/model/user-roles.enum';
import { AdminRole } from 'src/users/model/admin-roles.enum';

export interface JwtPayload {
  userId: string;
  role: UserRoles;
  adminRole?: AdminRole;
  sessionVersion: number;
}

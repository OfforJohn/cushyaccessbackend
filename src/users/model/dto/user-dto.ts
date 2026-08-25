import { UserRoles } from '../user-roles.enum';
import { AdminRole } from '../admin-roles.enum';

export class UsersDto {
  id: string;

  firstName: string;

  lastName: string;

  dateOfBirth?: string;
  birthdayUpdatesRemaining?: number;

  email: string;

  password: string;

  mobile: string;

  hasVerify: boolean;
  hasSetLocation: boolean;

  userRole: UserRoles;

  adminRole?: AdminRole;

  location: string;
  callingCode: string;

  profilePic?: string;
}

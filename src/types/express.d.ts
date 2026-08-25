import { Users } from '../users/model/users.entity';

declare global {
  namespace Express {
    interface Request {
      user?: Users | { id: string } | any;
    }
  }
}
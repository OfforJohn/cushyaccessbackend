import { Injectable, Scope, Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { Users } from '../users/model/users.entity';

@Injectable({ scope: Scope.REQUEST })
export class CommonService {
  constructor(@Inject(REQUEST) private readonly request: Request) {}

  async getLoggedInUser(): Promise<Users> {
    const user = (await this.request.user) as Users;
    return user;
  }
}

// src/common/guards/api-key.guard.ts
import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { ApiKeyService } from './api-key.service';
import { StandardResponse } from '../common/module/standard-response';
import { API_KEY } from './api-key.decorator';
import { UsersService } from '../users/services/users.service';
import { UserRoles } from '../users/model/user-roles.enum';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userService: UsersService,
    private readonly apiKeyService: ApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride(API_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) return true;
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['cushy-api-key'];

    if (!apiKey) throw new UnauthorizedException('API key missing');

    const apiKeyRow = apiKey.replace('CUSHY-', '').replace('-X', '');
    const hashedKey = createHash('sha256').update(apiKeyRow).digest('hex');
    const { isActive, userId } =
      await this.apiKeyService.validateKey(hashedKey);

    if (!isActive) throw new UnauthorizedException('Invalid API key');

    const user = await this.userService.findById(userId);
    if (!user) {
      throw new BadRequestException(
        new StandardResponse(true, 'UNAUTHENTICATED_USER'),
      );
    }
    if (user.userRole !== UserRoles.THIRD_PARTY) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'UNAUTHORIZED_USER'),
      );
    }

    request['user'] = {
      id: user.id,
      email: user.email,
      role: user.userRole,
      mobile: user.mobile,
      firstName: user.firstName,
      lastName: user.lastName,
    };

    return true;
  }
}

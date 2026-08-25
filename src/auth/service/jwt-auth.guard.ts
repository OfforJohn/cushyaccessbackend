import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_JEY } from './public.decorator';
import { StandardResponse } from 'src/common/module/standard-response';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/users/services/users.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private configService: ConfigService,
    private usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride(IS_PUBLIC_JEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'UNAUTHORIZED'),
      );
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get('SECRET_KEY'),
      });

      const user = await this.usersService.findAuthUserById(payload.userId);
      if (!user) {
        throw new BadRequestException(
          new StandardResponse(true, 'UNAUTHENTICATED_USER'),
        );
      }
      if ((payload.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
        throw new UnauthorizedException(
          new StandardResponse(true, 'SESSION_REVOKED'),
        );
      }

      request['user'] = {
        id: user.id,
        email: user.email,
        role: user.userRole,
        mobile: user.mobile,
        firstName: user.firstName,
        lastName: user.lastName,
        adminRole: user.adminRole,
      };
    } catch (e) {
      if (e instanceof TokenExpiredError)
        throw new UnauthorizedException(
          new StandardResponse(false, 'TOKEN_EXPIRED'),
        );
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException();
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const authHeader: any = request.headers['cushy-access-key'];
    const [type, token] = authHeader?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

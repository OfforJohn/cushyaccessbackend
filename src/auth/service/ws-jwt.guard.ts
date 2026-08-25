// src/auth/guards/ws-jwt.guard.ts

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/users/services/users.service';
import { IS_PUBLIC_JEY } from './public.decorator';
import { StandardResponse } from 'src/common/module/standard-response';
import { UserRoles } from 'src/users/model/user-roles.enum';

@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private configService: ConfigService,
    private usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if the route is public
    const isPublic = this.reflector.getAllAndOverride(IS_PUBLIC_JEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    try {
      const client: Socket = context.switchToWs().getClient();

      // Extract token from WebSocket connection
      const token = this.extractTokenFromSocket(client);

      if (!token) {
        this.logger.warn(`No token provided for client: ${client.id}`);
        throw new WsException(new StandardResponse(true, 'UNAUTHORIZED'));
      }

      // Verify the token
      try {
        const payload = await this.jwtService.verifyAsync(token, {
          secret: this.configService.get('SECRET_KEY'),
        });

        // Authentication must bypass cache so deleted accounts and revoked
        // sessions cannot reconnect during cache propagation.
        const user = await this.usersService.findAuthUserById(payload.userId);
        if (!user) {
          throw new WsException(
            new StandardResponse(true, 'UNAUTHENTICATED_USER'),
          );
        }
        if ((payload.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
          throw new WsException(new StandardResponse(true, 'SESSION_REVOKED'));
        }

        // Attach user data to socket
        client.data.user = {
          id: user.id,
          email: user.email,
          role: user.userRole,
          mobile: user.mobile,
          firstName: user.firstName,
          lastName: user.lastName,
          adminRole: user.adminRole,
        };

        // Set user type based on role
        if (user.userRole === UserRoles.RIDER) {
          client.data.userType = 'RIDER';
          // If riderId is in payload or we need to look it up
          client.data.riderId = payload.riderId || user.id;
        } else if (user.userRole === UserRoles.CUSTOMER) {
          client.data.userType = 'CUSTOMER';
        } else if (user.userRole === UserRoles.ADMIN) {
          client.data.userType = 'ADMIN';
        } else if (user.userRole === UserRoles.VENDOR) {
          client.data.userType = 'VENDOR';
        }

        this.logger.debug(`User authenticated: ${user.id} as ${user.userRole}`);
        return true;
      } catch (error: any) {
        if (error instanceof TokenExpiredError) {
          throw new WsException(new StandardResponse(false, 'TOKEN_EXPIRED'));
        }
        this.logger.error(`Token verification failed: ${error.message}`);
        throw new WsException(new StandardResponse(true, 'UNAUTHORIZED'));
      }
    } catch (error: any) {
      if (error instanceof WsException) {
        throw error;
      }
      this.logger.error(`WebSocket auth error: ${error.message}`);
      throw new WsException(new StandardResponse(true, 'UNAUTHORIZED'));
    }
  }

  /**
   * Extract JWT token from WebSocket connection
   */
  private extractTokenFromSocket(client: Socket): string | undefined {
    // 1. Check Socket.IO's dedicated auth object (io(url, { auth: { token } }))
    const auth = client.handshake.auth;
    if (auth?.token && typeof auth.token === 'string') {
      return auth.token;
    }

    // 2. Check query parameters
    const query = client.handshake.query;
    if (query.token && typeof query.token === 'string') {
      return query.token;
    }

    if (query.auth && typeof query.auth === 'string') {
      try {
        const parsedAuth = JSON.parse(query.auth);
        if (parsedAuth.token) {
          return parsedAuth.token;
        }
      } catch {
        return query.auth;
      }
    }

    // 3. Headers
    const headers = client.handshake.headers;
    const authHeader = headers['cushy-access-key'];
    if (authHeader && typeof authHeader === 'string') {
      const [type, token] = authHeader.split(' ');
      if (type === 'Bearer' && token) {
        return token;
      }
      return authHeader;
    }

    if (headers.authorization && typeof headers.authorization === 'string') {
      const [type, token] = headers.authorization.split(' ');
      if (type === 'Bearer' && token) {
        return token;
      }
      return headers.authorization;
    }

    if (
      headers['x-access-token'] &&
      typeof headers['x-access-token'] === 'string'
    ) {
      return headers['x-access-token'];
    }

    return undefined;
  }
}

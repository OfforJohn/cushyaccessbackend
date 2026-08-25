import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

@Injectable()
export class HybridThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const user = req.user;
    if (user?.id) {
      return `user-${user.id}`;
    }

    let ip: string = req.ip;
    if (!ip) {
      const forwarded = req.headers?.['x-forwarded-for'];
      if (forwarded) {
        ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
      } else {
        ip = req.connection?.remoteAddress || 'unknown';
      }
    }

    return `ip-${ip}`;
  }

  // protected async generateKey(context: ExecutionContext, suffix: string): Promise<string> {
  //   const req = this.getRequestResponse(context).req;
  //   const tracker = await this.getTracker(req);
  //   const route = `${req.method}-${req.route?.path || req.url}`;
  //   return `${tracker}-${route}-${suffix}`;
  // }
}
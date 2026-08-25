// analytics/interceptors/analytics.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AnalyticsService } from '../analytics.service';

@Injectable()
export class AnalyticsInterceptor implements NestInterceptor {
  constructor(private analyticsService: AnalyticsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return next.handle();
    }

    // const userId = user.id;
    // const method = request.method;
    // const path = request.route?.path || request.url;

    // if (path.includes('/api/v1/auth/login')) {
    //   this.analyticsService.trackUserActivity(userId, 'login', {
    //     path,
    //     method,
    //   });
    // }

    return next.handle();
  }
}
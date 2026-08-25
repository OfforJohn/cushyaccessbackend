import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class AdminActionLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AdminAction');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, query } = request;
    const user = request.user;
    const now = Date.now();

    // Only log mutating actions (POST, PATCH, PUT, DELETE)
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle();
    }

    // Only log actions performed by admins. This includes financial
    // endpoints under /wallet, not only routes under /admin.
    if (user?.role !== 'ADMIN') {
      return next.handle();
    }

    const adminEmail = user?.email || 'unknown';
    const adminId = user?.userId || user?.id || 'unknown';
    const adminRole = user?.adminRole || 'unknown';

    // Sanitize body - remove sensitive fields
    const sanitizedBody = { ...body };
    if (sanitizedBody.password) sanitizedBody.password = '***REDACTED***';
    if (sanitizedBody.newPassword) sanitizedBody.newPassword = '***REDACTED***';
    if (sanitizedBody.accountPassword)
      sanitizedBody.accountPassword = '***REDACTED***';
    if (sanitizedBody.pin) sanitizedBody.pin = '***REDACTED***';
    if (sanitizedBody.accountNumber) {
      sanitizedBody.accountNumber = `******${String(sanitizedBody.accountNumber).slice(-4)}`;
    }

    return next.handle().pipe(
      tap({
        next: (response) => {
          const duration = Date.now() - now;
          const isError = response?.error === true;
          const message = response?.message || 'N/A';

          this.logger.log(
            `[${method}] ${url} | Admin: ${adminEmail} (${adminId}, ${adminRole}) | ` +
              `Status: ${isError ? 'FAILED' : 'SUCCESS'} | Message: ${message} | ` +
              `Duration: ${duration}ms | ` +
              `Body: ${JSON.stringify(sanitizedBody)} | ` +
              `Query: ${JSON.stringify(query)}`,
          );
        },
        error: (error) => {
          const duration = Date.now() - now;
          this.logger.error(
            `[${method}] ${url} | Admin: ${adminEmail} (${adminId}, ${adminRole}) | ` +
              `Status: ERROR | Error: ${error.message} | ` +
              `Duration: ${duration}ms | ` +
              `Body: ${JSON.stringify(sanitizedBody)} | ` +
              `Query: ${JSON.stringify(query)}`,
          );
        },
      }),
    );
  }
}

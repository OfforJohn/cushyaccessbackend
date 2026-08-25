// src/middleware/LoggingMiddleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import moment from 'moment-timezone';
import { logger } from '../../logger.service';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
    use(req: Request, res: Response, next: NextFunction) {
        const startTime = Date.now();
        let responseBody = '';

        // Capture response data
        const originalWrite = res.write;
        const originalEnd = res.end;

        res.write = function (chunk: any, ...args: any[]) {
            responseBody += chunk.toString(); // Append response data
            return originalWrite.apply(res, [chunk, ...args]);
        };

        res.end = function (chunk: any, ...args: any[]) {
            if (chunk) responseBody += chunk.toString(); // Append final chunk
            const duration = Date.now() - startTime;

            // Log request and response details
            const logMessage = {
                method: req.method,
                url: req.originalUrl,
                status: res.statusCode,
                responseTime: `${duration}ms`,
                timestamp: moment().tz('Africa/Lagos').format('YYYY-MM-DD HH:mm:ss'),
                response: this.get('content-type')?.includes('json') ? JSON.parse(responseBody || '{}') : responseBody,
            };

            if (res.statusCode >= 400) {
                logger.error(logMessage); // Log errors
            } else {
                logger.info(logMessage); // Log successful responses
            }

            return originalEnd.apply(res, [chunk, ...args]);
        };

        next();
    }
}

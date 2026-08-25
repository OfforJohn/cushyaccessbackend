// src/filters/AllExceptionsFilter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import moment from 'moment-timezone';
import { logger } from '../../logger.service';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal Server Error';

    const errorResponse = {
      timestamp: moment().tz('Africa/Lagos').format('YYYY-MM-DD HH:mm:ss'),
      method: request.method,
      url: request.url,
      status,
      message,
    };

    logger.error(errorResponse); // Log the error
    response.status(status).json(errorResponse);
  }
}

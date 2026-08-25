// src/logger.ts
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import moment from 'moment-timezone';

export const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({
      format: () => moment().tz('Africa/Lagos').format('YYYY-MM-DD HH:mm:ss'),
    }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.DailyRotateFile({
      filename: 'logs/%DATE%-requests.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      level: 'info',
    }),
    new winston.transports.DailyRotateFile({
      filename: 'logs/%DATE%-errors.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '30d',
      level: 'error',
    }),
  ],
});

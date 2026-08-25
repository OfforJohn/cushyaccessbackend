import { Injectable } from '@nestjs/common';
import {
  HealthCheckService,
  HttpHealthIndicator,
  TypeOrmHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import * as os from 'os';

@Injectable()
export class HealthService {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private http: HttpHealthIndicator,
    private disk: DiskHealthIndicator,
  ) {}

  async getHealthStatus() {
    const healthCheckResult = await this.health.check([
      // Database check
      async () => this.db.pingCheck('database', { timeout: 800 }),
      async () =>
        this.http.pingCheck('aws', 'https://dynamodb.eu-west-1.amazonaws.com', {
          timeout: 800,
        }),

      // Disk usage check
      async () =>
        this.disk.checkStorage('storage', {
          path: '/',
          thresholdPercent: 0.9,
        }),
    ]);

    const serverInfo = {
      hostname: os.hostname(),
      platform: os.platform(),
      architecture: os.arch(),
      uptime: process.uptime(),
      loadAverage: os.loadavg(),
      totalMemoryGB: this.bytesToGB(os.totalmem()),
      freeMemoryGB: this.bytesToGB(os.freemem()),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development',
      appVersion: process.env.npm_package_version || 'unknown',
      timestamp: new Date().toISOString(),
    };

    return {
      ...healthCheckResult,
      server: serverInfo,
    };
  }

  private bytesToGB = (bytes: number) => (bytes / 1024 ** 3).toFixed(2);
}

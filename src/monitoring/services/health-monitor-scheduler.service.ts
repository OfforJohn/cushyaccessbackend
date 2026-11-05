import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import fetch from 'node-fetch';
import { NotificationService } from '../../notification/services/notification.service';
import { FirebaseScheduleStoreService } from './firebase-schedule-store.service';

type HealthCheckResult = {
  healthy: boolean;
  status?: string;
  statusCode?: number;
  error?: string;
  services: Record<string, { status: string }>;
  checkedAt: number;
  notification?: 'sent' | 'no-token' | 'not-needed' | 'failed';
};

const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 24 * 60;
const REQUEST_TIMEOUT_MS = 12_000;

@Injectable()
export class HealthMonitorSchedulerService {
  private readonly logger = new Logger(HealthMonitorSchedulerService.name);
  private readonly runningUsers = new Set<string>();

  constructor(
    private readonly schedules: FirebaseScheduleStoreService,
    private readonly notifications: NotificationService,
  ) {}

  async getSchedule(userId: string) {
    return await this.schedules.getSchedule(userId) ?? {
      userId,
      enabled: false,
      intervalMinutes: 15,
      nextRunAt: null,
      lastHealthy: null,
      lastStatus: 'not_checked',
      lastStatusCode: null,
      lastError: null,
      lastServices: null,
      lastCheckedAt: null,
    };
  }

  async setSchedule(userId: string, enabled: unknown, intervalMinutes: unknown) {
    if (typeof enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean.');
    }

    const interval = Number(intervalMinutes);
    if (!Number.isInteger(interval) || interval < MIN_INTERVAL_MINUTES || interval > MAX_INTERVAL_MINUTES) {
      throw new BadRequestException(`intervalMinutes must be an integer from ${MIN_INTERVAL_MINUTES} to ${MAX_INTERVAL_MINUTES}.`);
    }

    await this.schedules.saveSchedule(userId, {
      enabled,
      intervalMinutes: interval,
      nextRunAt: enabled ? new Date() : null,
    });
    return this.getSchedule(userId);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processDueSchedules() {
    const now = new Date();
    try {
      const dueSchedules = await this.schedules.claimDueSchedules(now, 100);
      const outcomes = await Promise.allSettled(dueSchedules.map(({ userId }) => this.checkForUser(userId)));
      outcomes.forEach((outcome) => {
        if (outcome.status === 'rejected') {
          this.logger.error(`Scheduled health check failed: ${outcome.reason instanceof Error ? outcome.reason.message : 'unknown error'}`);
        }
      });
    } catch (error) {
      this.logger.error(`Could not load due health-monitor schedules: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  async checkNow(userId: string): Promise<HealthCheckResult> {
    const schedule = await this.schedules.getSchedule(userId);
    if (!schedule) throw new NotFoundException('Enable monitoring before requesting a server health check.');
    return this.checkForUser(userId);
  }

  private async checkForUser(userId: string): Promise<HealthCheckResult> {
    if (this.runningUsers.has(userId)) {
      throw new BadRequestException('A health check is already running for this account.');
    }

    this.runningUsers.add(userId);
    try {
      const schedule = await this.schedules.getSchedule(userId);
      if (!schedule) throw new NotFoundException('Monitoring schedule not found.');

      const result = await this.probeHealthEndpoint();
      const previousHealth = schedule.lastHealthy ?? null;
      const shouldNotify = result.healthy !== previousHealth && (previousHealth !== null || !result.healthy);

      await this.schedules.saveSchedule(userId, {
        lastHealthy: result.healthy,
        lastStatus: result.status || (result.healthy ? 'healthy' : 'unhealthy'),
        lastStatusCode: result.statusCode ?? null,
        lastError: result.error ?? null,
        lastServices: result.services,
        lastCheckedAt: new Date(result.checkedAt),
      });

      if (!shouldNotify) {
        result.notification = 'not-needed';
        return result;
      }

      const title = result.healthy ? 'Service recovered' : 'Service health issue';
      const body = result.healthy
        ? 'The monitored service is responding normally again.'
        : `The monitored service is unhealthy${result.error ? `: ${result.error}` : ` (HTTP ${result.statusCode ?? 'unavailable'})`}.`;

      try {
        const delivery = await this.notifications.sendToUser(
          userId,
          title,
          body,
          { type: 'HEALTH_MONITOR', healthy: String(result.healthy) },
        );
        result.notification = delivery.sent > 0 ? 'sent' : 'no-token';
      } catch (error) {
        result.notification = 'failed';
        this.logger.error(`Health-monitor push failed for user ${userId}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }

      return result;
    } finally {
      this.runningUsers.delete(userId);
    }
  }

  private async probeHealthEndpoint(): Promise<HealthCheckResult> {
    const configuredUrl = process.env.SERVICE_HEALTH_URL ||
      `${(process.env.RENDER_EXTERNAL_URL || 'https://cushyaccessbackend.onrender.com').replace(/\/$/, '')}/monitoring/health`;
    const checkedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(configuredUrl, { signal: controller.signal });
      const payload = await response.json().catch(() => ({})) as {
        status?: string;
        services?: Record<string, string | { status?: string }>;
      };
      const services = Object.fromEntries(
        Object.entries(payload.services ?? {}).map(([name, value]) => [
          name,
          { status: (typeof value === 'string' ? value : value.status || 'unknown').toLowerCase() },
        ]),
      );
      const hasDownService = Object.values(services).some((service) => service.status === 'down' || service.status === 'unhealthy');
      const healthy = response.ok && payload.status !== 'unhealthy' && !hasDownService;

      return {
        healthy,
        status: payload.status || (healthy ? 'healthy' : 'unhealthy'),
        statusCode: response.status,
        services,
        checkedAt,
      };
    } catch (error) {
      return {
        healthy: false,
        status: 'unhealthy',
        error: error instanceof Error && error.name === 'AbortError' ? 'Health check timed out.' : 'Health endpoint request failed.',
        services: {},
        checkedAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

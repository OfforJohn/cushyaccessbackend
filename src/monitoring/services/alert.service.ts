import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MonitoringAlert } from '../entities/monitoring-alert.entity';
import { AlertType } from '../enums/alert-type.enum';
import { AlertSeverity } from '../enums/alert-severity.enum';
import { AlertStatus } from '../enums/alert-status.enum';
import { OperationalMetric } from '../entities/operational-metric.entity';
import { SystemMetric } from '../entities/system-metric.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MonitoringGateway } from '../gateways/monitoring.gateway';
import { MailSenderService } from '../../user-otp/mail-sender.service';
import { DashboardService } from './dashboard.service';

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  
  // Default alert thresholds
  private readonly alertThresholds = {
    [AlertType.HIGH_CANCELLATION_RATE]: { threshold: 10, severity: AlertSeverity.HIGH },
    [AlertType.LOW_RIDER_AVAILABILITY]: { threshold: 5, severity: AlertSeverity.MEDIUM },
    [AlertType.HIGH_ERROR_RATE]: { threshold: 5, severity: AlertSeverity.HIGH },
    [AlertType.SLOW_RESPONSE_TIME]: { threshold: 2000, severity: AlertSeverity.MEDIUM },
    [AlertType.SYSTEM_DOWN]: { threshold: 0, severity: AlertSeverity.CRITICAL },
  };

  constructor(
    @InjectRepository(MonitoringAlert)
    private alertRepository: Repository<MonitoringAlert>,
    @InjectRepository(OperationalMetric)
    private operationalMetricRepository: Repository<OperationalMetric>,
    @InjectRepository(SystemMetric)
    private systemMetricRepository: Repository<SystemMetric>,
    private eventEmitter: EventEmitter2,
    private monitoringGateway: MonitoringGateway,
    private configService: ConfigService,
    private mailSenderService: MailSenderService,
    private dashboardService: DashboardService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkAlerts() {
    try {
      await this.checkCancellationRateAlert();
      await this.checkRiderAvailabilityAlert();
      await this.checkErrorRateAlert();
      await this.checkResponseTimeAlert();
      await this.checkSystemHealthAlert();
      
      this.logger.debug('Alert checks completed');
    } catch (error) {
      this.logger.error('Error checking alerts:', error);
    }
  }

  private async checkCancellationRateAlert() {
    const recentMetric = await this.operationalMetricRepository.findOne({
      where: { metricName: 'cancellation_rate' },
      order: { timestamp: 'DESC' },
    });

    if (recentMetric && recentMetric.value > this.alertThresholds[AlertType.HIGH_CANCELLATION_RATE].threshold) {
      await this.triggerAlert(
        AlertType.HIGH_CANCELLATION_RATE,
        this.alertThresholds[AlertType.HIGH_CANCELLATION_RATE].severity,
        recentMetric.value,
        `High cancellation rate detected: ${recentMetric.value.toFixed(2)}%`,
        { metricId: recentMetric.id, timestamp: recentMetric.timestamp },
      );
    }
  }

  private async checkRiderAvailabilityAlert() {
    const recentMetric = await this.operationalMetricRepository.findOne({
      where: { metricName: 'riders_online' },
      order: { timestamp: 'DESC' },
    });

    if (recentMetric && recentMetric.value < this.alertThresholds[AlertType.LOW_RIDER_AVAILABILITY].threshold) {
      await this.triggerAlert(
        AlertType.LOW_RIDER_AVAILABILITY,
        this.alertThresholds[AlertType.LOW_RIDER_AVAILABILITY].severity,
        recentMetric.value,
        `Low rider availability: ${recentMetric.value} riders online`,
        { metricId: recentMetric.id, timestamp: recentMetric.timestamp },
      );
    }
  }

  private async checkErrorRateAlert() {
    const recentMetric = await this.systemMetricRepository.findOne({
      where: { metricName: 'error_rate' },
      order: { timestamp: 'DESC' },
    });

    if (recentMetric && recentMetric.value > this.alertThresholds[AlertType.HIGH_ERROR_RATE].threshold) {
      await this.triggerAlert(
        AlertType.HIGH_ERROR_RATE,
        this.alertThresholds[AlertType.HIGH_ERROR_RATE].severity,
        recentMetric.value,
        `High error rate detected: ${recentMetric.value.toFixed(2)}%`,
        { metricId: recentMetric.id, timestamp: recentMetric.timestamp },
      );
    }
  }

  private async checkResponseTimeAlert() {
    const recentMetric = await this.systemMetricRepository.findOne({
      where: { metricName: 'api_response_time' },
      order: { timestamp: 'DESC' },
    });

    if (recentMetric && recentMetric.value > this.alertThresholds[AlertType.SLOW_RESPONSE_TIME].threshold) {
      await this.triggerAlert(
        AlertType.SLOW_RESPONSE_TIME,
        this.alertThresholds[AlertType.SLOW_RESPONSE_TIME].severity,
        recentMetric.value,
        `Slow API response time: ${recentMetric.value.toFixed(0)}ms`,
        { metricId: recentMetric.id, timestamp: recentMetric.timestamp },
      );
    }
  }

  private async checkSystemHealthAlert() {
    const recentMetric = await this.systemMetricRepository.findOne({
      where: { metricName: 'database_connection' },
      order: { timestamp: 'DESC' },
    });

    if (recentMetric && recentMetric.value === 0) {
      await this.triggerAlert(
        AlertType.SYSTEM_DOWN,
        this.alertThresholds[AlertType.SYSTEM_DOWN].severity,
        recentMetric.value,
        'System health check failed - database connection issue',
        { metricId: recentMetric.id, timestamp: recentMetric.timestamp },
      );
    }
  }

  private async triggerAlert(
    type: AlertType,
    severity: AlertSeverity,
    currentValue: number,
    message: string,
    metadata: Record<string, any>,
  ) {
    // Check if there's already an active alert of this type
    const existingAlert = await this.alertRepository.findOne({
      where: {
        type,
        status: AlertStatus.ACTIVE,
      },
    });

    if (existingAlert) {
      // Update existing alert
      existingAlert.currentValue = currentValue;
      existingAlert.lastOccurredAt = new Date();
      existingAlert.occurrenceCount += 1;
      await this.alertRepository.save(existingAlert);
      
      this.eventEmitter.emit('alert.updated', existingAlert);
      this.monitoringGateway.broadcastAlertUpdate(existingAlert);
    } else {
      // Create new alert
      const threshold = this.alertThresholds[type]?.threshold || 0;
      const alert = this.alertRepository.create({
        type,
        severity,
        status: AlertStatus.ACTIVE,
        message,
        thresholdValue: threshold,
        currentValue,
        metadata,
        notificationChannels: ['email', 'push'],
      });
      
      const savedAlert = await this.alertRepository.save(alert);
      this.eventEmitter.emit('alert.created', savedAlert);
      this.monitoringGateway.broadcastAlert(savedAlert);
      void this.sendAlertEmail(savedAlert);
      
      this.logger.warn(`Alert triggered: ${type} - ${message}`);
    }
  }

  private async sendAlertEmail(alert: MonitoringAlert): Promise<void> {
    const recipient = this.configService
      .get<string>('MONITORING_ALERT_EMAIL')
      ?.trim();

    if (!recipient) {
      this.logger.warn(
        `Monitoring alert email skipped: MONITORING_ALERT_EMAIL is not configured (alert ${alert.id})`,
      );
      return;
    }

    try {
      const monitoringSnapshot =
        await this.dashboardService.getMonitoringEmailSnapshot();
      const result = await this.mailSenderService.sendMail({
        recipient,
        subject: `[${alert.severity.toUpperCase()}] Cushy Access monitoring alert: ${alert.type}`,
        template: 'monitoring-alert',
        content: {
          alertId: alert.id,
          type: alert.type,
          severity: alert.severity,
          status: alert.status,
          message: alert.message,
          thresholdValue: alert.thresholdValue,
          currentValue: alert.currentValue,
          createdAt: alert.createdAt?.toISOString(),
          ...monitoringSnapshot,
        },
      });

      if (!result) {
        this.logger.error(`Monitoring alert email delivery failed for ${alert.id}`);
      }
    } catch (error) {
      this.logger.error(
        `Could not send monitoring alert email for ${alert.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async acknowledgeAlert(alertId: string, userId: string) {
    const alert = await this.alertRepository.findOne({ where: { id: alertId } });
    
    if (!alert) {
      throw new Error('Alert not found');
    }

    alert.status = AlertStatus.ACKNOWLEDGED;
    alert.acknowledgedBy = userId;
    alert.acknowledgedAt = new Date();
    
    const updatedAlert = await this.alertRepository.save(alert);
    this.eventEmitter.emit('alert.acknowledged', updatedAlert);
    
    return updatedAlert;
  }

  async resolveAlert(alertId: string, userId: string, notes?: string) {
    const alert = await this.alertRepository.findOne({ where: { id: alertId } });
    
    if (!alert) {
      throw new Error('Alert not found');
    }

    alert.status = AlertStatus.RESOLVED;
    alert.resolvedBy = userId;
    alert.resolvedAt = new Date();
    alert.resolutionNotes = notes;
    
    const updatedAlert = await this.alertRepository.save(alert);
    this.eventEmitter.emit('alert.resolved', updatedAlert);
    
    return updatedAlert;
  }

  async snoozeAlert(alertId: string, until: Date) {
    const alert = await this.alertRepository.findOne({ where: { id: alertId } });
    
    if (!alert) {
      throw new Error('Alert not found');
    }

    alert.status = AlertStatus.SNOOZED;
    alert.snoozedUntil = until;
    
    const updatedAlert = await this.alertRepository.save(alert);
    this.eventEmitter.emit('alert.snoozed', updatedAlert);
    
    return updatedAlert;
  }

  async getActiveAlerts() {
    return this.alertRepository.find({
      where: { status: AlertStatus.ACTIVE },
      order: { severity: 'DESC', createdAt: 'DESC' },
    });
  }

  async getAllAlerts(limit: number = 50, offset: number = 0) {
    return this.alertRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async getAlertById(alertId: string) {
    return this.alertRepository.findOne({ where: { id: alertId } });
  }

  async updateAlertThreshold(type: AlertType, threshold: number, severity?: AlertSeverity) {
    this.alertThresholds[type] = { 
      threshold, 
      severity: severity || this.alertThresholds[type]?.severity || AlertSeverity.MEDIUM 
    };
    
    this.logger.log(`Updated threshold for ${type}: ${threshold}`);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupOldAlerts() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const result = await this.alertRepository.delete({
      status: AlertStatus.RESOLVED,
      resolvedAt: Between(new Date(0), thirtyDaysAgo),
    });
    
    if (result.affected > 0) {
      this.logger.log(`Cleaned up ${result.affected} old resolved alerts`);
    }
  }
}
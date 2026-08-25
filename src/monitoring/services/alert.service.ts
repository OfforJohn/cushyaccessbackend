import { Injectable, Logger } from '@nestjs/common';
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
      
      this.logger.warn(`Alert triggered: ${type} - ${message}`);
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
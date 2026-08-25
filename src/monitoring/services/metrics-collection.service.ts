import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SystemMetric } from '../entities/system-metric.entity';
import { OperationalMetric } from '../entities/operational-metric.entity';
import { Orders } from '../../orders/model/order.entity';
import { Rider, RiderStatus } from '../../riders/model/rider.entity';
import { Stores } from '../../stores/model/stores.entity';
import { OrderStatus } from '../../orders/model/enum/order-status.enum';

@Injectable()
export class MetricsCollectionService {
  private readonly logger = new Logger(MetricsCollectionService.name);

  constructor(
    @InjectRepository(SystemMetric)
    private systemMetricRepository: Repository<SystemMetric>,
    @InjectRepository(OperationalMetric)
    private operationalMetricRepository: Repository<OperationalMetric>,
    @InjectRepository(Orders)
    private ordersRepository: Repository<Orders>,
    @InjectRepository(Rider)
    private ridersRepository: Repository<Rider>,
    @InjectRepository(Stores)
    private storesRepository: Repository<Stores>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async collectOperationalMetrics() {
    try {
      const timestamp = new Date();
      
      // Collect order metrics
      await this.collectOrderMetrics(timestamp);
      
      // Collect rider metrics
      await this.collectRiderMetrics(timestamp);
      
      // Collect store metrics
      await this.collectStoreMetrics(timestamp);
      
      this.logger.debug('Operational metrics collected successfully');
    } catch (error) {
      this.logger.error('Error collecting operational metrics:', error);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async collectSystemMetrics() {
    try {
      const timestamp = new Date();
      
      // Collect API response time (placeholder - would need actual implementation)
      await this.saveSystemMetric('api_response_time', 150, 'ms', timestamp, {
        endpoint: 'average',
      });
      
      // Collect error rate (placeholder - would need actual implementation)
      await this.saveSystemMetric('error_rate', 0.5, '%', timestamp, {
        period: '5m',
      });
      
      // Collect database connection health
      await this.saveSystemMetric('database_connection', 1, 'boolean', timestamp, {
        status: 'healthy',
      });
      
      this.logger.debug('System metrics collected successfully');
    } catch (error) {
      this.logger.error('Error collecting system metrics:', error);
    }
  }

  private async collectOrderMetrics(timestamp: Date) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [pending, inProgress, completed, cancelled, totalToday] = await Promise.all([
      this.ordersRepository.count({ where: { status: OrderStatus.pending } }),
      this.ordersRepository.count({ 
        where: { status: In([OrderStatus.acknoledged, OrderStatus.in_transit, OrderStatus.picked_up]) } 
      }),
      this.ordersRepository.count({ where: { status: OrderStatus.delivered } }),
      this.ordersRepository.count({ where: { status: OrderStatus.cancelled } }),
      this.ordersRepository.count({ 
        where: { 
          createdAt: Between(todayStart, todayEnd) 
        } 
      }),
    ]);

    await this.saveOperationalMetric('orders_pending', pending, 'count', timestamp, { status: 'pending' });
    await this.saveOperationalMetric('orders_in_progress', inProgress, 'count', timestamp, { status: 'in_progress' });
    await this.saveOperationalMetric('orders_completed', completed, 'count', timestamp, { status: 'completed' });
    await this.saveOperationalMetric('orders_cancelled', cancelled, 'count', timestamp, { status: 'cancelled' });
    await this.saveOperationalMetric('orders_total_today', totalToday, 'count', timestamp, { period: 'today' });
  }

  private async collectRiderMetrics(timestamp: Date) {
    const [online, active, total] = await Promise.all([
      this.ridersRepository.count({ where: { isOnline: true, status: RiderStatus.ACTIVE } }),
      this.ridersRepository.count({ where: { status: RiderStatus.ACTIVE } }),
      this.ridersRepository.count(),
    ]);

    await this.saveOperationalMetric('riders_online', online, 'count', timestamp, { status: 'online' });
    await this.saveOperationalMetric('riders_active', active, 'count', timestamp, { status: 'active' });
    await this.saveOperationalMetric('riders_total', total, 'count', timestamp, { status: 'total' });
  }

  private async collectStoreMetrics(timestamp: Date) {
    const [active, suspended, total] = await Promise.all([
      this.storesRepository.count({ where: { isSuspended: false, isVisible: true } }),
      this.storesRepository.count({ where: { isSuspended: true } }),
      this.storesRepository.count(),
    ]);

    await this.saveOperationalMetric('stores_active', active, 'count', timestamp, { status: 'active' });
    await this.saveOperationalMetric('stores_suspended', suspended, 'count', timestamp, { status: 'suspended' });
    await this.saveOperationalMetric('stores_total', total, 'count', timestamp, { status: 'total' });
  }

  private async saveSystemMetric(
    metricName: string,
    value: number,
    unit: string,
    timestamp: Date,
    metadata?: Record<string, any>,
  ) {
    const metric = this.systemMetricRepository.create({
      metricName,
      value,
      unit,
      timestamp,
      metadata,
      service: 'cushy-backend',
      environment: process.env.NODE_ENV || 'development',
    });
    
    await this.systemMetricRepository.save(metric);
  }

  private async saveOperationalMetric(
    metricName: string,
    value: number,
    unit: string,
    timestamp: Date,
    metadata?: Record<string, any>,
  ) {
    const metric = this.operationalMetricRepository.create({
      metricName,
      value,
      unit,
      timestamp,
      metadata,
    });
    
    await this.operationalMetricRepository.save(metric);
  }

  async getRecentOperationalMetrics(minutes: number = 60) {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    
    return this.operationalMetricRepository.find({
      where: { timestamp: Between(since, new Date()) },
      order: { timestamp: 'DESC' },
    });
  }

  async getRecentSystemMetrics(minutes: number = 60) {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    
    return this.systemMetricRepository.find({
      where: { timestamp: Between(since, new Date()) },
      order: { timestamp: 'DESC' },
    });
  }

  async getMetricByName(metricName: string, minutes: number = 60) {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    
    return this.operationalMetricRepository.find({
      where: {
        metricName,
        timestamp: Between(since, new Date()),
      },
      order: { timestamp: 'DESC' },
    });
  }

  // Manual trigger for testing
  async manualCollect() {
    await this.collectOperationalMetrics();
    await this.collectSystemMetrics();
  }
}
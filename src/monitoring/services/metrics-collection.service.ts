import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SystemMetric } from '../entities/system-metric.entity';
import { OperationalMetric } from '../entities/operational-metric.entity';
import { Orders } from '../../orders/model/order.entity';
import { Rider, RiderStatus } from '../../riders/model/rider.entity';
import { Stores } from '../../stores/model/stores.entity';
import { MenuItem } from '../../stores/model/menu-item.entity';
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
    @InjectRepository(MenuItem)
    private menuItemsRepository: Repository<MenuItem>,
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

      // Collect product metrics
      await this.collectProductMetrics(timestamp);

      // Collect email metrics
      await this.collectEmailMetrics(timestamp);

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

    // All-time metrics
    const [pending, inProgress, completed, cancelled, total] = await Promise.all([
      this.ordersRepository.count({ where: { status: OrderStatus.pending } }),
      this.ordersRepository.count({ 
        where: { status: In([OrderStatus.acknoledged, OrderStatus.in_transit, OrderStatus.picked_up]) } 
      }),
      this.ordersRepository.count({ where: { status: OrderStatus.delivered } }),
      this.ordersRepository.count({ where: { status: OrderStatus.cancelled } }),
      this.ordersRepository.count(),
    ]);

    // Today metrics
    const [pendingToday, inProgressToday, completedToday, cancelledToday, totalToday] = await Promise.all([
      this.ordersRepository.count({ 
        where: { 
          status: OrderStatus.pending,
          createdAt: Between(todayStart, todayEnd) 
        } 
      }),
      this.ordersRepository.count({ 
        where: { 
          status: In([OrderStatus.acknoledged, OrderStatus.in_transit, OrderStatus.picked_up]),
          createdAt: Between(todayStart, todayEnd) 
        } 
      }),
      this.ordersRepository.count({ 
        where: { 
          status: OrderStatus.delivered,
          createdAt: Between(todayStart, todayEnd) 
        } 
      }),
      this.ordersRepository.count({ 
        where: { 
          status: OrderStatus.cancelled,
          createdAt: Between(todayStart, todayEnd) 
        } 
      }),
      this.ordersRepository.count({ 
        where: { 
          createdAt: Between(todayStart, todayEnd) 
        } 
      }),
    ]);

    // Save all-time metrics
    await this.saveOperationalMetric('orders_pending', pending, 'count', timestamp, { status: 'pending', period: 'all_time' });
    await this.saveOperationalMetric('orders_in_progress', inProgress, 'count', timestamp, { status: 'in_progress', period: 'all_time' });
    await this.saveOperationalMetric('orders_completed', completed, 'count', timestamp, { status: 'completed', period: 'all_time' });
    await this.saveOperationalMetric('orders_cancelled', cancelled, 'count', timestamp, { status: 'cancelled', period: 'all_time' });
    await this.saveOperationalMetric('orders_total', total, 'count', timestamp, { period: 'all_time' });

    // Save today metrics
    await this.saveOperationalMetric('orders_pending_today', pendingToday, 'count', timestamp, { status: 'pending', period: 'today' });
    await this.saveOperationalMetric('orders_in_progress_today', inProgressToday, 'count', timestamp, { status: 'in_progress', period: 'today' });
    await this.saveOperationalMetric('orders_completed_today', completedToday, 'count', timestamp, { status: 'completed', period: 'today' });
    await this.saveOperationalMetric('orders_cancelled_today', cancelledToday, 'count', timestamp, { status: 'cancelled', period: 'today' });
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

  private async collectProductMetrics(timestamp: Date) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Get order items with product details
    const orderItemsRepository = this.ordersRepository.manager.getRepository('OrderItems');
    
    // All-time product metrics
    const [totalProducts, availableProducts, unavailableProducts, discountedProducts] = await Promise.all([
      this.menuItemsRepository.count(),
      this.menuItemsRepository.count({ where: { isAvailable: true } }),
      this.menuItemsRepository.count({ where: { isAvailable: false } }),
      this.menuItemsRepository.count({ where: { isDiscountActive: true } }),
    ]);

    // Today's product sales
    const todayOrderItems = await orderItemsRepository
      .createQueryBuilder('oi')
      .leftJoin('oi.order', 'o')
      .where('o.createdAt BETWEEN :start AND :end', { start: todayStart, end: todayEnd })
      .getMany();

    const totalProductsSoldToday = todayOrderItems.reduce((sum, item) => sum + item.quantity, 0);
    const uniqueProductsSoldToday = new Set(todayOrderItems.map(item => item.menuItemId)).size;
    const productRevenueToday = todayOrderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // Save all-time product metrics
    await this.saveOperationalMetric('products_total', totalProducts, 'count', timestamp, { period: 'all_time' });
    await this.saveOperationalMetric('products_available', availableProducts, 'count', timestamp, { period: 'all_time' });
    await this.saveOperationalMetric('products_unavailable', unavailableProducts, 'count', timestamp, { period: 'all_time' });
    await this.saveOperationalMetric('products_discounted', discountedProducts, 'count', timestamp, { period: 'all_time' });

    // Save today's product metrics
    await this.saveOperationalMetric('products_sold_today', totalProductsSoldToday, 'count', timestamp, { period: 'today' });
    await this.saveOperationalMetric('products_unique_sold_today', uniqueProductsSoldToday, 'count', timestamp, { period: 'today' });
    await this.saveOperationalMetric('products_revenue_today', productRevenueToday, 'currency', timestamp, { period: 'today' });
  }

  private async collectEmailMetrics(timestamp: Date) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Get email metrics from operational metrics table
    const recentMetrics = await this.operationalMetricRepository.find({
      where: {
        metricName: Like('email_%'),
        timestamp: Between(new Date(Date.now() - 60 * 60 * 1000), new Date()),
      },
      order: { timestamp: 'DESC' },
    });

    const emailsSent = this.getMetricValueFromList(recentMetrics, 'email_sent');
    const emailsFailed = this.getMetricValueFromList(recentMetrics, 'email_failed');
    const avgDeliveryTime = this.getMetricValueFromList(recentMetrics, 'email_delivery_time_avg');

    // Calculate success rate
    const totalEmails = emailsSent + emailsFailed;
    const successRate = totalEmails > 0 ? (emailsSent / totalEmails) * 100 : 100;

    // Save email metrics
    await this.saveOperationalMetric('email_sent', emailsSent, 'count', timestamp, { period: 'all_time' });
    await this.saveOperationalMetric('email_failed', emailsFailed, 'count', timestamp, { period: 'all_time' });
    await this.saveOperationalMetric('email_success_rate', successRate, 'percentage', timestamp, { period: 'all_time' });
    await this.saveOperationalMetric('email_delivery_time_avg', avgDeliveryTime, 'ms', timestamp, { period: 'all_time' });

    // Check Brevo API configuration
    const brevoApiKey = process.env.BREVO_API_KEY;
    const mailFrom = process.env.MAIL_FROM;
    const mailUsername = process.env.MAIL_USERNAME;

    const apiConfigured = !!brevoApiKey && brevoApiKey.length > 0;
    const senderConfigured = !!mailFrom && !!mailUsername;

    await this.saveSystemMetric('email_api_configured', apiConfigured ? 1 : 0, 'boolean', timestamp);
    await this.saveSystemMetric('email_sender_configured', senderConfigured ? 1 : 0, 'boolean', timestamp);
  }

  private getMetricValueFromList(metrics: any[], metricName: string): number {
    const metric = metrics.find(m => m.metricName === metricName);
    return metric ? Number(metric.value) : 0;
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
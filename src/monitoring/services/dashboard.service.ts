import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Like, In } from 'typeorm';
import { OperationalMetric } from '../entities/operational-metric.entity';
import { SystemMetric } from '../entities/system-metric.entity';
import { MonitoringAlert } from '../entities/monitoring-alert.entity';
import { EmailLog, EmailStatus } from '../entities/email-log.entity';
import { MailSenderService } from '../../user-otp/mail-sender.service';
import { OrderItems } from '../../orders/model/order-items.entity';
import { MenuItem } from '../../stores/model/menu-item.entity';
import { MenuCategory } from '../../stores/model/menu-category.entity';

export interface OperationsOverview {
  orders: {
    pending: number;
    inProgress: number;
    completed: number;
    cancelled: number;
    totalToday: number;
  };
  riders: {
    online: number;
    active: number;
    total: number;
  };
  stores: {
    active: number;
    suspended: number;
    total: number;
  };
  system: {
    apiResponseTime: number;
    errorRate: number;
    databaseHealth: boolean;
  };
}

export interface LiveMapData {
  riders: Array<{
    id: string;
    latitude: number;
    longitude: number;
    status: string;
    activeDeliveries: number;
  }>;
  orders: Array<{
    id: string;
    status: string;
    pickupLocation: { lat: number; lng: number };
    dropoffLocation: { lat: number; lng: number };
  }>;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(OperationalMetric)
    private operationalMetricRepository: Repository<OperationalMetric>,
    @InjectRepository(SystemMetric)
    private systemMetricRepository: Repository<SystemMetric>,
    @InjectRepository(MonitoringAlert)
    private alertRepository: Repository<MonitoringAlert>,
    @InjectRepository(EmailLog)
    private emailLogRepository: Repository<EmailLog>,
    @InjectRepository(OrderItems)
    private orderItemsRepository: Repository<OrderItems>,
    @InjectRepository(MenuItem)
    private menuItemRepository: Repository<MenuItem>,
    @InjectRepository(MenuCategory)
    private menuCategoryRepository: Repository<MenuCategory>,
    private mailSenderService: MailSenderService,
  ) {}

  async getOperationsOverview(): Promise<OperationsOverview> {
    // Get recent operational metrics
    const recentMetrics = await this.operationalMetricRepository.find({
      where: {
        timestamp: Between(new Date(Date.now() - 60 * 60 * 1000), new Date()),
      },
      order: { timestamp: 'DESC' },
    });

    const orders = {
      pending: this.getMetricValue(recentMetrics, 'orders_pending_today'),
      inProgress: this.getMetricValue(recentMetrics, 'orders_in_progress_today'),
      completed: this.getMetricValue(recentMetrics, 'orders_completed_today'),
      cancelled: this.getMetricValue(recentMetrics, 'orders_cancelled_today'),
      totalToday: this.getMetricValue(recentMetrics, 'orders_total_today'),
    };

    const riders = {
      online: this.getMetricValue(recentMetrics, 'riders_online'),
      active: this.getMetricValue(recentMetrics, 'riders_active'),
      total: this.getMetricValue(recentMetrics, 'riders_total'),
    };

    const stores = {
      active: this.getMetricValue(recentMetrics, 'stores_active'),
      suspended: this.getMetricValue(recentMetrics, 'stores_suspended'),
      total: this.getMetricValue(recentMetrics, 'stores_total'),
    };

    // Get system metrics
    const apiResponseTimeMetric = await this.systemMetricRepository.findOne({
      where: { metricName: 'api_response_time' },
      order: { timestamp: 'DESC' },
    });

    const errorRateMetric = await this.systemMetricRepository.findOne({
      where: { metricName: 'error_rate' },
      order: { timestamp: 'DESC' },
    });

    const dbHealthMetric = await this.systemMetricRepository.findOne({
      where: { metricName: 'database_connection' },
      order: { timestamp: 'DESC' },
    });

    const system = {
      apiResponseTime: apiResponseTimeMetric?.value || 0,
      errorRate: errorRateMetric?.value || 0,
      databaseHealth: dbHealthMetric?.value === 1,
    };

    return { orders, riders, stores, system };
  }

  private getMetricValue(metrics: any[], metricName: string): number {
    const metric = metrics.find(m => m.metricName === metricName);
    return metric ? Number(metric.value) : 0;
  }

  async getOrderMetrics() {
    const recentMetrics = await this.operationalMetricRepository.find({
      where: {
        metricName: Like('orders_%'),
        timestamp: Between(new Date(Date.now() - 60 * 60 * 1000), new Date()),
      },
      order: { timestamp: 'DESC' },
    });

    // Separate all-time and today metrics
    const allTimeMetrics = {
      pending: this.getMetricValue(recentMetrics, 'orders_pending'),
      inProgress: this.getMetricValue(recentMetrics, 'orders_in_progress'),
      completed: this.getMetricValue(recentMetrics, 'orders_completed'),
      cancelled: this.getMetricValue(recentMetrics, 'orders_cancelled'),
      total: this.getMetricValue(recentMetrics, 'orders_total'),
    };

    const todayMetrics = {
      pending: this.getMetricValue(recentMetrics, 'orders_pending_today'),
      inProgress: this.getMetricValue(recentMetrics, 'orders_in_progress_today'),
      completed: this.getMetricValue(recentMetrics, 'orders_completed_today'),
      cancelled: this.getMetricValue(recentMetrics, 'orders_cancelled_today'),
      total: this.getMetricValue(recentMetrics, 'orders_total_today'),
    };

    return {
      allTime: allTimeMetrics,
      today: todayMetrics,
    };
  }

  async getRiderMetrics() {
    // Placeholder implementation - would need RidersModule dependency
    return [
      { status: 'online', count: 0 },
      { status: 'active', count: 0 },
      { status: 'total', count: 0 },
    ];
  }

  async getStoreMetrics() {
    // Placeholder implementation - would need StoresModule dependency
    return [
      { status: 'active', count: 0 },
      { status: 'suspended', count: 0 },
      { status: 'total', count: 0 },
    ];
  }

  async getProductMetrics() {
    const recentMetrics = await this.operationalMetricRepository.find({
      where: {
        metricName: Like('products_%'),
        timestamp: Between(new Date(Date.now() - 60 * 60 * 1000), new Date()),
      },
      order: { timestamp: 'DESC' },
    });

    const allTimeMetrics = {
      total: this.getMetricValue(recentMetrics, 'products_total'),
      available: this.getMetricValue(recentMetrics, 'products_available'),
      unavailable: this.getMetricValue(recentMetrics, 'products_unavailable'),
      discounted: this.getMetricValue(recentMetrics, 'products_discounted'),
    };

    const todayMetrics = {
      sold: this.getMetricValue(recentMetrics, 'products_sold_today'),
      uniqueSold: this.getMetricValue(recentMetrics, 'products_unique_sold_today'),
      revenue: this.getMetricValue(recentMetrics, 'products_revenue_today'),
    };

    return {
      allTime: allTimeMetrics,
      today: todayMetrics,
    };
  }

  async getTopProducts(limit: number = 10) {
    // Placeholder implementation - would need OrdersModule dependency
    return [];
  }

  async getProductRevenueByCategory() {
    try {
      // Get all menu categories
      const categories = await this.menuCategoryRepository.find({
        relations: ['menuItems'],
      });

      const revenueByCategory = await Promise.all(
        categories.map(async (category) => {
          // Get all menu items in this category
          const menuItems = await this.menuItemRepository.find({
            where: { menuCategoryId: category.id },
          });

          const menuItemIds = menuItems.map((item) => item.id);

          // Get all order items for these menu items
          const orderItems = await this.orderItemsRepository.find({
            where: { menuItemId: In(menuItemIds) },
          });

          // Calculate total revenue and items sold
          const totalRevenue = orderItems.reduce(
            (sum, item) => sum + Number(item.price) * item.quantity,
            0,
          );

          const itemsSold = orderItems.reduce(
            (sum, item) => sum + item.quantity,
            0,
          );

          return {
            category: category.name,
            revenue: totalRevenue,
            itemsSold,
            uniqueProducts: menuItems.length,
          };
        }),
      );

      return revenueByCategory.filter((cat) => cat.revenue > 0);
    } catch (error) {
      this.logger.error('Failed to fetch product revenue by category:', error);
      return [];
    }
  }

  async getEmailMetrics() {
    const recentMetrics = await this.operationalMetricRepository.find({
      where: {
        metricName: Like('email_%'),
        timestamp: Between(new Date(Date.now() - 60 * 60 * 1000), new Date()),
      },
      order: { timestamp: 'DESC' },
    });

    const deliveryMetrics = {
      sent: this.getMetricValue(recentMetrics, 'email_sent'),
      failed: this.getMetricValue(recentMetrics, 'email_failed'),
      successRate: this.getMetricValue(recentMetrics, 'email_success_rate'),
      avgDeliveryTime: this.getMetricValue(recentMetrics, 'email_delivery_time_avg'),
    };

    return deliveryMetrics;
  }

  async getEmailHealth() {
    const recentSystemMetrics = await this.systemMetricRepository.find({
      where: {
        metricName: Like('email_%'),
        timestamp: Between(new Date(Date.now() - 5 * 60 * 1000), new Date()),
      },
      order: { timestamp: 'DESC' },
    });

    const apiConfigured = this.getMetricValue(recentSystemMetrics, 'email_api_configured') === 1;
    const senderConfigured = this.getMetricValue(recentSystemMetrics, 'email_sender_configured') === 1;

    const recentMetrics = await this.operationalMetricRepository.find({
      where: {
        metricName: Like('email_%'),
        timestamp: Between(new Date(Date.now() - 60 * 60 * 1000), new Date()),
      },
      order: { timestamp: 'DESC' },
    });

    const successRate = this.getMetricValue(recentMetrics, 'email_success_rate');
    const failedCount = this.getMetricValue(recentMetrics, 'email_failed');

    const health = {
      status: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
      configuration: {
        apiConfigured,
        senderConfigured,
      },
      delivery: {
        successRate,
        failedCount,
      },
      lastCheck: new Date(),
    };

    // Determine overall health status
    if (!apiConfigured || !senderConfigured) {
      health.status = 'unhealthy';
    } else if (successRate < 90 || failedCount > 10) {
      health.status = 'degraded';
    }

    return health;
  }

  async sendTestEmail(email: string) {
    try {
      const response = await this.mailSenderService.sendMail({
        recipient: email,
        subject: 'Cushy Access Email Monitoring Test',
        template: 'otp',
        content: {
          email,
          timestamp: new Date().toISOString(),
        },
      });

      if (response) {
        return {
          success: true,
          message: 'Test email sent successfully',
          timestamp: new Date(),
        };
      } else {
        return {
          success: false,
          message: 'Failed to send test email',
          error: 'Email service returned null response',
          timestamp: new Date(),
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: 'Failed to send test email',
        error: errorMessage,
        timestamp: new Date(),
      };
    }
  }

  async getEmailLogs(limit: number = 50, offset: number = 0) {
    try {
      const logs = await this.emailLogRepository.find({
        order: { timestamp: 'DESC' },
        take: limit,
        skip: offset,
      });

      return {
        success: true,
        data: logs,
        count: logs.length,
        timestamp: new Date(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to fetch email logs:', error);
      return {
        success: false,
        message: 'Failed to fetch email logs',
        error: errorMessage,
        timestamp: new Date(),
      };
    }
  }

  async getLiveMapData(): Promise<LiveMapData> {
    // Placeholder implementation - would integrate with actual location data
    return { riders: [], orders: [] };
  }

  async getInfrastructureHealth() {
    const recentMetrics = await this.systemMetricRepository.find({
      where: {
        timestamp: Between(new Date(Date.now() - 5 * 60 * 1000), new Date()),
      },
      order: { timestamp: 'DESC' },
    });
    
    const healthMap = new Map();
    recentMetrics.forEach(metric => {
      healthMap.set(metric.metricName, {
        value: metric.value,
        unit: metric.unit,
        timestamp: metric.timestamp,
        status: this.determineHealthStatus(metric.metricName, metric.value),
      });
    });
    
    return Object.fromEntries(healthMap);
  }

  private determineHealthStatus(metricName: string, value: number): 'healthy' | 'warning' | 'critical' {
    switch (metricName) {
      case 'api_response_time':
        if (value > 3000) return 'critical';
        if (value > 1500) return 'warning';
        return 'healthy';
      case 'error_rate':
        if (value > 10) return 'critical';
        if (value > 5) return 'warning';
        return 'healthy';
      case 'database_connection':
        return value === 1 ? 'healthy' : 'critical';
      default:
        return 'healthy';
    }
  }

  async getRecentAlerts(limit: number = 10) {
    return this.alertRepository.find({
      where: { status: 'active' as any },
      order: { severity: 'DESC', createdAt: 'DESC' },
      take: limit,
    });
  }

  async getMetricsTrend(metricName: string, hours: number = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const metrics = await this.operationalMetricRepository.find({
      where: {
        metricName,
        timestamp: Between(since, new Date()),
      },
      order: { timestamp: 'ASC' },
    });
    
    return metrics.map(metric => ({
      timestamp: metric.timestamp,
      value: metric.value,
      unit: metric.unit,
    }));
  }
}
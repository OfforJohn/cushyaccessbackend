import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Like } from 'typeorm';
import { Rider, RiderStatus } from '../../riders/model/rider.entity';
import { Stores } from '../../stores/model/stores.entity';

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
import { OperationalMetric } from '../entities/operational-metric.entity';
import { SystemMetric } from '../entities/system-metric.entity';
import { MonitoringAlert } from '../entities/monitoring-alert.entity';

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
    @InjectRepository(Rider)
    private ridersRepository: Repository<Rider>,
    @InjectRepository(Stores)
    private storesRepository: Repository<Stores>,
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
      pending: this.getMetricValue(recentMetrics, 'orders_pending'),
      inProgress: this.getMetricValue(recentMetrics, 'orders_in_progress'),
      completed: this.getMetricValue(recentMetrics, 'orders_completed'),
      cancelled: this.getMetricValue(recentMetrics, 'orders_cancelled'),
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

    return recentMetrics.map(metric => ({
      status: metric.metricName.replace('orders_', ''),
      count: Number(metric.value),
    }));
  }

  async getRiderMetrics() {
    const [online, active, total] = await Promise.all([
      this.ridersRepository.count({ where: { isOnline: true, status: RiderStatus.ACTIVE } }),
      this.ridersRepository.count({ where: { status: RiderStatus.ACTIVE } }),
      this.ridersRepository.count(),
    ]);

    return [
      { status: 'online', count: online },
      { status: 'active', count: active },
      { status: 'total', count: total },
    ];
  }

  async getStoreMetrics() {
    const [active, suspended, total] = await Promise.all([
      this.storesRepository.count({ where: { isSuspended: false, isVisible: true } }),
      this.storesRepository.count({ where: { isSuspended: true } }),
      this.storesRepository.count(),
    ]);

    return [
      { status: 'active', count: active },
      { status: 'suspended', count: suspended },
      { status: 'total', count: total },
    ];
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
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiUsageMetric } from '../model/entity/ai-usage-metric.entity';
import { AiUsageHistory, AiCostInfo, AiErrorRates } from '../ai-diagnostic.service';

export interface RecordUsageOptions {
  provider: string;
  requestCount?: number;
  tokenCount?: number;
  errorCount?: number;
  cost?: number;
  responseTime?: number;
  userId?: string;
  chatId?: string;
  requestMessage?: string;
  responseMessage?: string;
  isTest?: boolean;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AiUsageTrackingService {
  private readonly logger = new Logger(AiUsageTrackingService.name);

  constructor(
    @InjectRepository(AiUsageMetric)
    private readonly usageMetricRepository: Repository<AiUsageMetric>,
  ) {}

  async recordUsage(options: RecordUsageOptions): Promise<AiUsageMetric> {
    try {
      const metric = this.usageMetricRepository.create({
        id: `ai-metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        provider: options.provider,
        requestCount: options.requestCount || 1,
        tokenCount: options.tokenCount || 0,
        errorCount: options.errorCount || 0,
        cost: options.cost || 0,
        responseTime: options.responseTime || 0,
        userId: options.userId,
        chatId: options.chatId,
        requestMessage: options.requestMessage,
        responseMessage: options.responseMessage,
        isTest: options.isTest || false,
        metadata: options.metadata,
      });

      const saved = await this.usageMetricRepository.save(metric);
      this.logger.debug(`Recorded usage metric for ${options.provider}: ${metric.id}`);
      return saved;
    } catch (error) {
      this.logger.error(`Failed to record usage metric: ${error.message}`);
      throw error;
    }
  }

  async getUsageHistory(
    provider: string,
    days: number = 7,
  ): Promise<AiUsageHistory[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      const metrics = await this.usageMetricRepository
        .createQueryBuilder('metric')
        .where('metric.provider = :provider', { provider })
        .andWhere('metric.createdAt >= :startDate', { startDate })
        .orderBy('metric.createdAt', 'ASC')
        .getMany();

      // Group by date
      const dailyData = new Map<string, AiUsageHistory>();

      for (const metric of metrics) {
        const dateKey = metric.createdAt.toISOString().split('T')[0];
        
        if (!dailyData.has(dateKey)) {
          dailyData.set(dateKey, {
            date: dateKey,
            requests: 0,
            tokens: 0,
            errors: 0,
            cost: 0,
          });
        }

        const daily = dailyData.get(dateKey)!;
        daily.requests += metric.requestCount;
        daily.tokens += metric.tokenCount;
        daily.errors += metric.errorCount;
        daily.cost += parseFloat(metric.cost.toString());
      }

      return Array.from(dailyData.values());
    } catch (error) {
      this.logger.error(`Failed to get usage history: ${error.message}`);
      return [];
    }
  }

  async getCostInfo(provider: string, days: number = 30): Promise<AiCostInfo> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      const result = await this.usageMetricRepository
        .createQueryBuilder('metric')
        .select('SUM(metric.requestCount)', 'totalRequests')
        .addSelect('SUM(metric.tokenCount)', 'totalTokens')
        .addSelect('SUM(metric.cost)', 'totalCost')
        .where('metric.provider = :provider', { provider })
        .andWhere('metric.createdAt >= :startDate', { startDate })
        .getRawOne();

      const totalRequests = parseInt(result?.totalRequests || '0');
      const totalTokens = parseInt(result?.totalTokens || '0');
      const totalCost = parseFloat(result?.totalCost || '0');

      return {
        totalCost: parseFloat(totalCost.toFixed(4)),
        costPerRequest: totalRequests > 0 ? parseFloat((totalCost / totalRequests).toFixed(6)) : 0,
        costPerToken: totalTokens > 0 ? parseFloat((totalCost / totalTokens).toFixed(6)) : 0,
        currency: 'USD',
      };
    } catch (error) {
      this.logger.error(`Failed to get cost info: ${error.message}`);
      return {
        totalCost: 0,
        costPerRequest: 0,
        costPerToken: 0,
        currency: 'USD',
      };
    }
  }

  async getErrorRates(provider: string, days: number = 30): Promise<AiErrorRates> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      const result = await this.usageMetricRepository
        .createQueryBuilder('metric')
        .select('SUM(metric.requestCount)', 'totalRequests')
        .addSelect('SUM(metric.errorCount)', 'totalErrors')
        .where('metric.provider = :provider', { provider })
        .andWhere('metric.createdAt >= :startDate', { startDate })
        .getRawOne();

      const totalRequests = parseInt(result?.totalRequests || '0');
      const totalErrors = parseInt(result?.totalErrors || '0');
      const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

      // Get error types from metadata
      const metrics = await this.usageMetricRepository
        .createQueryBuilder('metric')
        .where('metric.provider = :provider', { provider })
        .andWhere('metric.createdAt >= :startDate', { startDate })
        .andWhere('metric.errorCount > 0')
        .getMany();

      const errorsByType: Record<string, number> = {};
      for (const metric of metrics) {
        const errorType = metric.metadata?.errorType as string || 'unknown';
        errorsByType[errorType] = (errorsByType[errorType] || 0) + metric.errorCount;
      }

      return {
        totalRequests,
        failedRequests: totalErrors,
        errorRate: parseFloat(errorRate.toFixed(4)),
        errorsByType,
      };
    } catch (error) {
      this.logger.error(`Failed to get error rates: ${error.message}`);
      return {
        totalRequests: 0,
        failedRequests: 0,
        errorRate: 0,
        errorsByType: {},
      };
    }
  }

  async getRecentTestMessages(limit: number = 10): Promise<AiUsageMetric[]> {
    try {
      return await this.usageMetricRepository
        .createQueryBuilder('metric')
        .where('metric.isTest = :isTest', { isTest: true })
        .orderBy('metric.createdAt', 'DESC')
        .limit(limit)
        .getMany();
    } catch (error) {
      this.logger.error(`Failed to get recent test messages: ${error.message}`);
      return [];
    }
  }

  async getTestMessageById(id: string): Promise<AiUsageMetric | null> {
    try {
      return await this.usageMetricRepository.findOne({
        where: { id },
      });
    } catch (error) {
      this.logger.error(`Failed to get test message: ${error.message}`);
      return null;
    }
  }

  async cleanupOldMetrics(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    try {
      const result = await this.usageMetricRepository
        .createQueryBuilder('metric')
        .delete()
        .where('metric.createdAt < :cutoffDate', { cutoffDate })
        .execute();

      const deletedCount = result.affected || 0;
      this.logger.log(`Cleaned up ${deletedCount} old usage metrics`);
      return deletedCount;
    } catch (error) {
      this.logger.error(`Failed to cleanup old metrics: ${error.message}`);
      return 0;
    }
  }
}

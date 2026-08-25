import { Injectable, Logger } from '@nestjs/common';
import { RedisCacheService } from 'src/redis-cache/redis-cache.service';

@Injectable()
export class SessionCacheService {
  private readonly logger = new Logger(SessionCacheService.name);
  private readonly TTL_SECONDS = 24 * 60 * 60; // 1 day
  private readonly KEY_PREFIX = 'cushy:session:';

  constructor(private redisCache: RedisCacheService) {}

  async get(userId: string): Promise<string | null> {
    try {
      const key = this.KEY_PREFIX + userId;
      const sessionId = await this.redisCache.getCachedItem(key);
      return sessionId ? String(sessionId) : null;
    } catch (err) {
      this.logger.error(`Failed to get session for user ${userId}`, err);
      return null;
    }
  }

  async set(userId: string, sessionId: string): Promise<void> {
    try {
      const key = this.KEY_PREFIX + userId;
      await this.redisCache.setItemInCache(key, sessionId, this.TTL_SECONDS);
      this.logger.debug(`Session ${sessionId} stored for user ${userId}`);
    } catch (err) {
      this.logger.error(`Failed to set session for user ${userId}`, err);
    }
  }

  async delete(userId: string): Promise<void> {
    try {
      const key = this.KEY_PREFIX + userId;
      await this.redisCache.deleteCachedItem(key);
    } catch (err) {
      this.logger.error(`Failed to delete session for user ${userId}`, err);
    }
  }
}
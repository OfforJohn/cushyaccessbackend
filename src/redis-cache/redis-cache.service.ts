import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';

@Injectable()
export class RedisCacheService {
  private readonly usesRedis: boolean;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    configService: ConfigService,
  ) {
    this.usesRedis =
      configService.get<string>('CACHE_MODE')?.trim().toLowerCase() === 'redis';
  }

  async setItemInCache(key: string, item: any, ttl?: number) {
    if (!item) {
      return;
    }
    if (ttl !== undefined) {
      if (this.usesRedis) {
        // cache-manager v5 memory stores accept milliseconds, while the
        // installed Redis adapter accepts an options object in seconds.
        await (this.cacheManager as any).set(key, item, {
          ttl: Math.max(1, Math.ceil(ttl / 1000)),
        });
      } else {
        await this.cacheManager.set(key, item, ttl);
      }
    } else {
      await this.cacheManager.set(key, item);
    }
  }

  async getCachedItem(key: string) {
    return await this.cacheManager.get(key);
  }

  async deleteCachedItem(key: string) {
    await this.cacheManager.del(key);
  }

  async resetCache() {
    await this.cacheManager.reset();
  }
}

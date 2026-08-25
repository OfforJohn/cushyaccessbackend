import { Module } from '@nestjs/common';
import { RedisCacheService } from './redis-cache.service';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-store';

const DEFAULT_CACHE_TTL_SECONDS = 30 * 60;
const DEFAULT_CACHE_TTL_MS = DEFAULT_CACHE_TTL_SECONDS * 1000;

@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const mode = configService.get<string>('CACHE_MODE') || 'memory';

        if (mode === 'redis') {
          return {
            store: redisStore as any,
            host: configService.get<string>('REDIS_HOST'),
            port: configService.get<number>('REDIS_PORT'),
            ttl: DEFAULT_CACHE_TTL_SECONDS,
          };
        }

        // Default → In-memory
        return {
          ttl: DEFAULT_CACHE_TTL_MS,
        };
      },
    }),
  ],
  providers: [RedisCacheService],
  exports: [RedisCacheService],
})
export class RedisCacheModule {}

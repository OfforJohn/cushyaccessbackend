import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { RedisCacheService } from './redis-cache.service';

describe('RedisCacheService TTL normalization', () => {
  const createService = (mode: string | undefined) => {
    const cache = {
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as Cache;
    const config = {
      get: jest.fn().mockReturnValue(mode),
    } as unknown as ConfigService;

    return { cache, service: new RedisCacheService(cache, config) };
  };

  it('passes millisecond TTLs through to the memory store', async () => {
    const { cache, service } = createService('memory');

    await service.setItemInCache(
      'voice-job',
      { status: 'processing' },
      900_000,
    );

    expect(cache.set).toHaveBeenCalledWith(
      'voice-job',
      { status: 'processing' },
      900_000,
    );
  });

  it('converts millisecond TTLs to Redis seconds/options', async () => {
    const { cache, service } = createService(' Redis ');

    await service.setItemInCache(
      'voice-job',
      { status: 'processing' },
      900_001,
    );

    expect(cache.set).toHaveBeenCalledWith(
      'voice-job',
      { status: 'processing' },
      { ttl: 901 },
    );
  });
});

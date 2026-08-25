import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  app.useStaticAssets(path.join(process.cwd(), 'public', 'email-assets'), {
    prefix: '/email-assets',
  });
  const useSocketRedis =
    process.env.SOCKET_REDIS_ENABLED === 'true' ||
    (process.env.NODE_ENV === 'production' &&
      process.env.SOCKET_REDIS_ENABLED !== 'false');
  let redisIoAdapter: RedisIoAdapter | undefined;
  if (useSocketRedis) {
    redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connect();
    app.useWebSocketAdapter(redisIoAdapter);
  }
  // The production service is behind a reverse proxy/load balancer. Keep the
  // hop count configurable so req.ip-based throttling matches the deployment.
  const configuredProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  const trustedProxyHops =
    Number.isInteger(configuredProxyHops) && configuredProxyHops >= 0
      ? configuredProxyHops
      : 1;
  app.getHttpAdapter().getInstance().set('trust proxy', trustedProxyHops);
  app.enableCors({
    origin: [
      'https://cagconsole.cushyaccess.com',
      'http://localhost:5173',
      'http://localhost:3000',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'cushy-access-key',
      'Cache-Control',
      'Pragma',
    ],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  await app.listen(process.env.PORT || 4000);
  console.log(`Application is running on: ${await app.getUrl()}`);

  const closeRedisAdapter = () => void redisIoAdapter?.disconnect();
  process.once('SIGTERM', closeRedisAdapter);
  process.once('SIGINT', closeRedisAdapter);
}
bootstrap();

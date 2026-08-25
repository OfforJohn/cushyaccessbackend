import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { RedisClientType, createClient } from 'redis';
import { ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private publisher?: RedisClientType;
  private subscriber?: RedisClientType;

  async connect(): Promise<void> {
    const redisUrl = this.getRedisUrl();
    const publisher = createClient({ url: redisUrl });
    const subscriber = publisher.duplicate();

    publisher.on('error', (error) =>
      this.logger.error(`Socket Redis publisher error: ${error.message}`),
    );
    subscriber.on('error', (error) =>
      this.logger.error(`Socket Redis subscriber error: ${error.message}`),
    );

    await Promise.all([publisher.connect(), subscriber.connect()]);
    this.publisher = publisher as RedisClientType;
    this.subscriber = subscriber as RedisClientType;
    this.adapterConstructor = createAdapter(publisher, subscriber, {
      key: process.env.SOCKET_REDIS_CHANNEL_PREFIX || 'cushy-access:socket.io',
      publishOnSpecificResponseChannel: true,
    });
    this.logger.log('Socket.IO Redis adapter connected.');
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (!this.adapterConstructor) {
      throw new Error('Socket.IO Redis adapter was not initialized');
    }
    server.adapter(this.adapterConstructor);
    return server;
  }

  async disconnect(): Promise<void> {
    await Promise.allSettled([this.publisher?.quit(), this.subscriber?.quit()]);
  }

  private getRedisUrl(): string {
    if (process.env.REDIS_URL?.trim()) return process.env.REDIS_URL.trim();

    const host = process.env.REDIS_HOST?.trim();
    if (!host) {
      throw new Error(
        'REDIS_URL or REDIS_HOST is required when the Socket.IO Redis adapter is enabled',
      );
    }
    const port = Number(process.env.REDIS_PORT || 6379);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('REDIS_PORT must be a valid TCP port');
    }

    const username = process.env.REDIS_USERNAME?.trim();
    const password = process.env.REDIS_PASSWORD;
    const credentials = password
      ? `${username ? `${encodeURIComponent(username)}:` : ':'}${encodeURIComponent(password)}@`
      : '';
    const protocol = process.env.REDIS_TLS === 'true' ? 'rediss' : 'redis';
    return `${protocol}://${credentials}${host}:${port}`;
  }
}

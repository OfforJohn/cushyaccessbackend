import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeys } from './api-keys.entity';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from './api-key.guards';
import { UsersModule } from '../users/users.module';
import { Reflector } from '@nestjs/core';

@Module({
  imports: [UsersModule, Reflector, TypeOrmModule.forFeature([ApiKeys])],
  providers: [ApiKeyService, ApiKeyGuard],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}

import { Module } from '@nestjs/common';
import { HealthCheckController } from './health_check.controller';
import { HealthService } from './health_check.service';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [TerminusModule, HttpModule],
  providers: [HealthService],
  controllers: [HealthCheckController],
})
export class HealthCheckModule {}

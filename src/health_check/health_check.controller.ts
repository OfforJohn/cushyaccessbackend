import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health_check.service';
import { Public } from '../auth/service/public.decorator';

@Controller('api/v1/health-check')
@Public()
export class HealthCheckController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check() {
    return this.healthService.getHealthStatus();
  }
}

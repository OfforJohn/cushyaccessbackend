import { Controller, Get, Query, Post, Body, Param } from '@nestjs/common';
import { AiDiagnosticService } from './ai-diagnostic.service';
import { Public } from '../auth/service/public.decorator';
import { AiTestingService } from './services/ai-testing.service';

@Controller('api/v1/ai-diagnostic')
@Public()
export class AiDiagnosticController {
  constructor(
    private readonly aiDiagnosticService: AiDiagnosticService,
    private readonly aiTestingService: AiTestingService,
  ) {}

  @Get()
  async check() {
    return this.aiDiagnosticService.getAiDiagnostics();
  }

  @Get('quotas')
  async getQuotas() {
    return this.aiDiagnosticService.getQuotaInfo();
  }

  @Get('quotas/bedrock')
  async getBedrockQuota() {
    const quotas = await this.aiDiagnosticService.getQuotaInfo();
    return {
      provider: 'bedrock',
      quota: quotas.providers.bedrock,
      timestamp: quotas.timestamp,
    };
  }

  @Get('quotas/gemini')
  async getGeminiQuota() {
    const quotas = await this.aiDiagnosticService.getQuotaInfo();
    return {
      provider: 'gemini',
      quota: quotas.providers.gemini,
      timestamp: quotas.timestamp,
    };
  }

  @Get('enhanced-quotas')
  async getEnhancedQuotas() {
    return this.aiDiagnosticService.getEnhancedQuotaInfo();
  }

  @Get('usage-history')
  async getUsageHistory(@Query('days') days?: number) {
    return this.aiDiagnosticService.getUsageHistory(days || 7);
  }

  @Get('cost-info')
  async getCostInfo() {
    return this.aiDiagnosticService.getCostInfo();
  }

  @Get('error-rates')
  async getErrorRates() {
    return this.aiDiagnosticService.getErrorRates();
  }

  @Post('test')
  async testProvider(@Body() body: { provider: 'gemini' | 'bedrock'; message: string }) {
    return this.aiTestingService.testProvider({
      provider: body.provider,
      message: body.message,
    });
  }

  @Get('test/history')
  async getTestHistory(@Query('limit') limit?: number) {
    return this.aiDiagnosticService.getTestHistory(limit || 10);
  }

  @Get('test/:id')
  async getTestMessageById(@Param('id') id: string) {
    return this.aiDiagnosticService.getTestMessageById(id);
  }
}

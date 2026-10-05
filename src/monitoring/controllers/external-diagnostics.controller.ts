import { Controller, Get, Query } from '@nestjs/common';
import { ExternalDiagnosticsService } from '../services/external-diagnostics.service';
import { Public } from '../../auth/service/public.decorator';

@Controller('monitoring/external')
@Public()
export class ExternalDiagnosticsController {
  constructor(
    private readonly externalDiagnosticsService: ExternalDiagnosticsService,
  ) {}

  @Get()
  async getAllDiagnostics() {
    return this.externalDiagnosticsService.getAllDiagnostics();
  }

  @Get('database')
  async getDatabaseHealth() {
    return this.externalDiagnosticsService.checkDatabase();
  }

  @Get('redis')
  async getRedisHealth() {
    return this.externalDiagnosticsService.checkRedis();
  }

  @Get('paystack')
  async getPaystackHealth() {
    return this.externalDiagnosticsService.checkPaystack();
  }

  @Get('s3')
  async getS3Health() {
    return this.externalDiagnosticsService.checkS3();
  }

  @Get('google-maps')
  async getGoogleMapsHealth() {
    return this.externalDiagnosticsService.checkGoogleMaps();
  }

  @Get('termii-sms')
  async getTermiiSMSHealth() {
    return this.externalDiagnosticsService.checkTermiiSMS();
  }

  @Get('brevo-email')
  async getBrevoEmailHealth() {
    return this.externalDiagnosticsService.checkBrevoEmail();
  }

  @Get('eightxeight')
  async getEightxEightHealth() {
    return this.externalDiagnosticsService.checkEightxEight();
  }

  @Get('track-that-ride')
  async getTrackThatRideHealth() {
    return this.externalDiagnosticsService.checkTrackThatRide();
  }

  @Get('firebase-push')
  async getFirebasePushHealth() {
    return this.externalDiagnosticsService.checkFirebasePush();
  }

  @Get('socket-io')
  async getSocketHealth() {
    return this.externalDiagnosticsService.checkSocketHealth();
  }
}

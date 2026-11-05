import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { DashboardService, OperationsOverview } from '../services/dashboard.service';
import { AlertService } from '../services/alert.service';
import { IncidentService } from '../services/incident.service';
import { JwtAuthGuard } from '../../auth/service/jwt-auth.guard';
import { Permit } from '../../auth/service/roles.decorator';
import { UserRoles } from '../../users/model/user-roles.enum';
import { HealthMonitorSchedulerService } from '../services/health-monitor-scheduler.service';

@Controller('api/v1/monitoring/mobile')
@UseGuards(JwtAuthGuard)
export class MobileController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly alertService: AlertService,
    private readonly incidentService: IncidentService,
    private readonly healthMonitorScheduler: HealthMonitorSchedulerService,
  ) {}

  @Get('health-monitor')
  async getHealthMonitorSchedule(@Request() req) {
    return this.healthMonitorScheduler.getSchedule(req.user.id);
  }

  @Put('health-monitor')
  async updateHealthMonitorSchedule(
    @Request() req,
    @Body() body: { enabled: boolean; intervalMinutes: number },
  ) {
    return this.healthMonitorScheduler.setSchedule(
      req.user.id,
      body.enabled,
      body.intervalMinutes,
    );
  }

  @Post('health-monitor/check-now')
  async checkHealthNow(@Request() req) {
    return this.healthMonitorScheduler.checkNow(req.user.id);
  }

  @Get('dashboard')
  @Permit([UserRoles.ADMIN])
  async getMobileDashboard(@Request() req): Promise<OperationsOverview | any> {
    const userRole = req.user?.role;
    
    // Return role-specific dashboard data
    switch (userRole) {
      case UserRoles.ADMIN:
        return this.dashboardService.getOperationsOverview();
      case UserRoles.RIDER:
        return this.getRiderDashboard(req.user?.id);
      case UserRoles.VENDOR:
        return this.getVendorDashboard(req.user?.id);
      default:
        return { message: 'Unauthorized role' };
    }
  }

  @Get('alerts')
  @Permit([UserRoles.ADMIN])
  async getMobileAlerts(@Query('limit') limit?: number) {
    return this.alertService.getActiveAlerts().then(alerts => 
      alerts.slice(0, limit || 10)
    );
  }

  @Get('incidents')
  @Permit([UserRoles.ADMIN])
  async getMobileIncidents(@Query('limit') limit?: number) {
    return this.incidentService.getActiveIncidents().then(incidents =>
      incidents.slice(0, limit || 10)
    );
  }

  @Post('register-device')
  @Permit([UserRoles.ADMIN])
  async registerDevice(@Request() req, @Body() body: { deviceToken: string; platform: string }) {
    // Implementation would register device token for push notifications
    return { message: 'Device registered successfully', deviceToken: body.deviceToken };
  }

  @Get('incidents/:id')
  @Permit([UserRoles.ADMIN])
  async getMobileIncidentById(@Param('id') id: string) {
    return this.incidentService.getIncidentById(id);
  }

  @Put('incidents/:id/update')
  @Permit([UserRoles.ADMIN])
  async updateMobileIncident(
    @Param('id') id: string,
    @Body() body: { status: string; notes?: string },
    @Request() req,
  ) {
    return this.incidentService.updateIncidentStatus(
      id,
      body.status as any,
      req.user?.id,
      body.notes,
    );
  }

  private async getRiderDashboard(riderId: string) {
    // Rider-specific dashboard data
    return {
      activeDeliveries: 0, // Would query rider's active orders
      todayEarnings: 0, // Would query rider's earnings
      rating: 4.5, // Would query rider's rating
      nextDelivery: null, // Would query next delivery
    };
  }

  private async getVendorDashboard(vendorId: string) {
    // Vendor-specific dashboard data
    return {
      activeOrders: 0, // Would query vendor's active orders
      todayRevenue: 0, // Would query vendor's revenue
      storeStatus: 'active', // Would query store status
      rating: 4.2, // Would query store rating
    };
  }
}
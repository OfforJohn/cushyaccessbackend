import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { DashboardService, OperationsOverview, LiveMapData } from '../services/dashboard.service';
import { AlertService } from '../services/alert.service';
import { IncidentService } from '../services/incident.service';
import { MetricsCollectionService } from '../services/metrics-collection.service';
import { AcknowledgeAlertDto } from '../dto/acknowledge-alert.dto';
import { CreateIncidentDto } from '../dto/create-incident.dto';
import { AdminRoleGuard } from '../../auth/service/admin-roles.guard';
import { PermitAdminRoles } from '../../auth/service/admin-roles.decorator';
import { AdminRole } from '../../users/model/admin-roles.enum';
import { Permit } from '../../auth/service/roles.decorator';
import { UserRoles } from '../../users/model/user-roles.enum';
import { Public } from '../../auth/service/public.decorator';

@Controller('monitoring')
@Public()
export class MonitoringController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly alertService: AlertService,
    private readonly incidentService: IncidentService,
    private readonly metricsCollectionService: MetricsCollectionService,
  ) {}

  // Operations Dashboard Endpoints
  @Get('operations/overview')
  async getOperationsOverview(): Promise<OperationsOverview> {
    return this.dashboardService.getOperationsOverview();
  }

  @Get('operations/orders')
  async getOrderMetrics() {
    return this.dashboardService.getOrderMetrics();
  }

  @Get('operations/riders')
  async getRiderMetrics() {
    return this.dashboardService.getRiderMetrics();
  }

  @Get('operations/stores')
  async getStoreMetrics() {
    return this.dashboardService.getStoreMetrics();
  }

  @Get('operations/products')
  async getProductMetrics() {
    return this.dashboardService.getProductMetrics();
  }

  @Get('operations/products/top')
  async getTopProducts(@Query('limit') limit?: number) {
    return this.dashboardService.getTopProducts(limit || 10);
  }

  @Get('operations/products/categories')
  async getProductRevenueByCategory() {
    return this.dashboardService.getProductRevenueByCategory();
  }

  // Email Monitoring Endpoints
  @Get('email/health')
  async getEmailHealth() {
    return this.dashboardService.getEmailHealth();
  }

  @Get('email/metrics')
  async getEmailMetrics() {
    return this.dashboardService.getEmailMetrics();
  }

  @Post('email/test')
  async sendTestEmail(@Body() body: { email: string }) {
    return this.dashboardService.sendTestEmail(body.email);
  }

  @Get('email/logs')
  async getEmailLogs(@Query('limit') limit?: number, @Query('offset') offset?: number) {
    return this.dashboardService.getEmailLogs(limit || 50, offset || 0);
  }

  @Get('operations/live-map')
  async getLiveMapData(): Promise<LiveMapData> {
    return this.dashboardService.getLiveMapData();
  }

  // Infrastructure Dashboard Endpoints
  @Get('infrastructure/health')
  async getInfrastructureHealth() {
    return this.dashboardService.getInfrastructureHealth();
  }

  @Get('infrastructure/metrics')
  async getSystemMetrics(@Query('hours') hours?: number) {
    return this.dashboardService.getMetricsTrend('api_response_time', hours || 24);
  }

  // Business Analytics Dashboard Endpoints
  @Get('analytics/revenue')
  async getRevenueMetrics(@Query('hours') hours?: number) {
    return this.dashboardService.getMetricsTrend('revenue', hours || 24);
  }

  @Get('analytics/users')
  async getUserMetrics(@Query('hours') hours?: number) {
    return this.dashboardService.getMetricsTrend('active_users', hours || 24);
  }

  @Get('analytics/performance')
  async getPerformanceMetrics(@Query('hours') hours?: number) {
    return this.dashboardService.getMetricsTrend('order_completion_rate', hours || 24);
  }

  // Alerts Endpoints
  @Get('alerts')
  async getAlerts(@Query('limit') limit?: number, @Query('offset') offset?: number) {
    return this.alertService.getAllAlerts(limit || 50, offset || 0);
  }

  @Get('alerts/active')
  async getActiveAlerts() {
    return this.alertService.getActiveAlerts();
  }

  @Get('alerts/:id')
  async getAlertById(@Param('id') id: string) {
    return this.alertService.getAlertById(id);
  }

  @Put('alerts/:id/acknowledge')
  async acknowledgeAlert(
    @Param('id') id: string,
    @Body() acknowledgeAlertDto: AcknowledgeAlertDto,
  ) {
    return this.alertService.acknowledgeAlert(id, acknowledgeAlertDto.userId);
  }

  @Put('alerts/:id/resolve')
  async resolveAlert(
    @Param('id') id: string,
    @Body() body: { userId: string; notes?: string },
  ) {
    return this.alertService.resolveAlert(id, body.userId, body.notes);
  }

  // Incidents Endpoints
  @Get('incidents')
  async getIncidents(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.incidentService.getIncidents({
      status: status as any,
      priority: priority as any,
      assignedTo,
      limit,
      offset,
    });
  }

  @Get('incidents/active')
  async getActiveIncidents() {
    return this.incidentService.getActiveIncidents();
  }

  @Get('incidents/stats')
  async getIncidentStats() {
    return this.incidentService.getIncidentStats();
  }

  @Get('incidents/:id')
  async getIncidentById(@Param('id') id: string) {
    return this.incidentService.getIncidentById(id);
  }

  @Post('incidents')
  async createIncident(@Body() createIncidentDto: CreateIncidentDto) {
    return this.incidentService.createIncident(createIncidentDto);
  }

  @Put('incidents/:id/assign')
  async assignIncident(
    @Param('id') id: string,
    @Body() body: { assignedTo: string; assignedBy: string },
  ) {
    return this.incidentService.assignIncident(id, body.assignedTo, body.assignedBy);
  }

  @Put('incidents/:id/status')
  async updateIncidentStatus(
    @Param('id') id: string,
    @Body() body: { status: string; updatedBy: string; notes?: string },
  ) {
    return this.incidentService.updateIncidentStatus(
      id,
      body.status as any,
      body.updatedBy,
      body.notes,
    );
  }

  @Put('incidents/:id/resolve')
  async resolveIncident(
    @Param('id') id: string,
    @Body() body: { resolvedBy: string; resolution: string; rootCause?: Record<string, any> },
  ) {
    return this.incidentService.resolveIncident(
      id,
      body.resolvedBy,
      body.resolution,
      body.rootCause,
    );
  }

  @Put('incidents/:id/post-mortem')
  async addPostMortem(
    @Param('id') id: string,
    @Body() body: { postMortemNotes: string; addedBy: string },
  ) {
    return this.incidentService.addPostMortem(id, body.postMortemNotes, body.addedBy);
  }

  @Put('incidents/:id/close')
  async closeIncident(
    @Param('id') id: string,
    @Body() body: { closedBy: string },
  ) {
    return this.incidentService.closeIncident(id, body.closedBy);
  }

  // Temporary endpoint for testing metrics collection
  @Post('metrics/collect')
  async triggerMetricsCollection() {
    await this.metricsCollectionService.manualCollect();
    return { message: 'Metrics collection triggered successfully' };
  }
}
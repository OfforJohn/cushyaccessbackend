// analytics/controllers/analytics.controller.ts
import {
  Controller,
  Get,
  Query,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { Permit } from 'src/auth/service/roles.decorator';
import { StandardResponse } from 'src/common/module/standard-response';
import { PermitAdminRoles } from 'src/auth/service/admin-roles.decorator';
import { AdminRole } from 'src/users/model/admin-roles.enum';

@Controller('api/v1/analytics')
@Permit([UserRoles.ADMIN])
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('daily')
  async getDailyMetrics(@Query('date') dateString?: string) {
    const date = dateString ? new Date(dateString) : new Date();

    if (isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    return this.analyticsService.getDailyMetrics(date);
  }

  @Get('new-users')
  async getNewUsers(@Query('date') dateString?: string) {
    const date = dateString ? new Date(dateString) : new Date();

    if (isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    const count = await this.analyticsService.getNewUsersPerDay(date);
    const result = { date: date.toISOString().split('T')[0], new_users: count };
    return new StandardResponse(
      false,
      'New users retrieved successfully',
      result,
    );
  }

  @Get('returning-users')
  async getReturningUsers(
    @Query('date') dateString?: string,
    @Query('days', new ParseIntPipe({ optional: true })) days = 7,
  ) {
    const date = dateString ? new Date(dateString) : new Date();

    if (isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    const count = await this.analyticsService.getReturningUsers(date, days);
    return new StandardResponse(
      false,
      'Returning users retrieved successfully',
      {
        date: date.toISOString().split('T')[0],
        returning_users: count,
        lookback_days: days,
      },
    );
  }

  @Get('churned-users')
  async getChurnedUsers(
    @Query('date') dateString?: string,
    @Query('inactiveDays', new ParseIntPipe({ optional: true }))
    inactiveDays = 30,
  ) {
    const date = dateString ? new Date(dateString) : new Date();

    if (isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    const count = await this.analyticsService.getChurnedUsers(
      date,
      inactiveDays,
    );
    const result = {
      date: date.toISOString().split('T')[0],
      churned_users: count,
      inactive_days_threshold: inactiveDays,
    };
    return new StandardResponse(
      false,
      'Churned users retrieved successfully',
      result,
    );
  }

  @Get('frequent-order-users')
  async getFrequentOrderUsers(
    @Query('date') dateString?: string,
    @Query('minOrders', new ParseIntPipe({ optional: true })) minOrders = 3,
    @Query('periodDays', new ParseIntPipe({ optional: true })) periodDays = 30,
  ) {
    const date = dateString ? new Date(dateString) : new Date();

    if (isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    const count = await this.analyticsService.getFrequentOrderUsers(
      date,
      minOrders,
      periodDays,
    );
    const result = {
      date: date.toISOString().split('T')[0],
      frequent_order_users: count,
      minimum_orders: minOrders,
      period_days: periodDays,
    };
    return new StandardResponse(
      false,
      'Frequent order users retrieved successfully',
      result,
    );
  }

  @Get('orders-per-user')
  async getOrdersPerUser(@Query('date') dateString?: string) {
    const date = dateString ? new Date(dateString) : new Date();

    if (isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    const data = await this.analyticsService.getOrdersPerUser(date);
    const result = {
      date: date.toISOString().split('T')[0],
      orders_per_user: data,
    };
    return new StandardResponse(
      false,
      'Orders per user retrieved successfully',
      result,
    );
  }

  @Get('user-age-distribution')
  @PermitAdminRoles(AdminRole.SUPER_ADMIN, AdminRole.MARKETING)
  async getUserAgeDistribution() {
    const result = await this.analyticsService.getUserAgeDistribution();
    return new StandardResponse(
      false,
      'User age distribution retrieved successfully',
      result,
    );
  }

  @Get('range')
  async getMetricsRange(
    @Query('startDate') startDateString: string,
    @Query('endDate') endDateString: string,
    @Query('metricType') metricType?: string,
  ) {
    const startDate = new Date(startDateString);
    const endDate = new Date(endDateString);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    if (startDate > endDate) {
      throw new BadRequestException('Start date must be before end date');
    }

    return this.analyticsService.getMetricsRange(
      startDate,
      endDate,
      metricType,
    );
  }
}

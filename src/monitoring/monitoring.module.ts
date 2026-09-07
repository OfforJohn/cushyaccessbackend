import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { CqrsModule } from '@nestjs/cqrs';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MonitoringGateway } from './gateways/monitoring.gateway';
import { MetricsCollectionService } from './services/metrics-collection.service';
import { AlertService } from './services/alert.service';
import { DashboardService } from './services/dashboard.service';
import { IncidentService } from './services/incident.service';
import { MonitoringController } from './controllers/monitoring.controller';
import { MobileController } from './controllers/mobile.controller';
import { OrderEventHandler } from './handlers/order-event.handler';
import { RiderEventHandler } from './handlers/rider-event.handler';
import { MonitoringAlert } from './entities/monitoring-alert.entity';
import { SystemMetric } from './entities/system-metric.entity';
import { OperationalMetric } from './entities/operational-metric.entity';
import { Incident } from './entities/incident.entity';
import { EmailLog } from './entities/email-log.entity';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { Orders } from '../orders/model/order.entity';
import { Rider } from '../riders/model/rider.entity';
import { Stores } from '../stores/model/stores.entity';
import { MenuItem } from '../stores/model/menu-item.entity';
import { OrderItems } from '../orders/model/order-items.entity';
import { MenuCategory } from '../stores/model/menu-category.entity';
import { UserOtpModule } from '../user-otp/user-otp.module';
import { OrderModule } from '../orders/orders.module';
import { RidersModule } from '../riders/riders.module';
import { StoresModule } from '../stores/stores.module';
import { MailSenderService } from '../user-otp/mail-sender.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MonitoringAlert,
      SystemMetric,
      OperationalMetric,
      Incident,
      EmailLog,
      Orders,
      Rider,
      Stores,
      MenuItem,
      OrderItems,
      MenuCategory,
    ]),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '1d' },
    }),
    UsersModule,
    AuthModule,
    UserOtpModule,
    OrderModule,
    RidersModule,
    StoresModule,
  ],
  controllers: [MonitoringController, MobileController],
  providers: [
    MonitoringGateway,
    MetricsCollectionService,
    AlertService,
    DashboardService,
    IncidentService,
    OrderEventHandler,
    RiderEventHandler,
    MailSenderService,
  ],
  exports: [
    MetricsCollectionService,
    AlertService,
    DashboardService,
    IncidentService,
    MonitoringGateway,
  ],
})
export class MonitoringModule {}
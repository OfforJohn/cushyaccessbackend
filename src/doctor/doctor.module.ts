import { Module } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { DoctorController } from './controllers/doctor.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfessionDetails } from './models/professional-details.entity';
import { UploadDoctorDocumentsUseCase } from './usecases/upload-doctor-documents.usecase';
import { S3Service } from 'src/utils/s3-bucket.service';
import { ConsultationSchedule } from './models/consultation-schedule.entity';
import { CommonModule } from 'src/common/common.module';
import { Users } from 'src/users/model/users.entity';
import { SaveScheduleUseCase } from './usecases/save-schedule.usecase';
import { Appointment } from './models/appointment.entity';
import { WalletService } from 'src/wallet/services/wallet.service';
import { Wallets } from 'src/wallet/model/wallet.entity';
import { AppointmentUseCase } from './usecases/book-appointment.usecase';
import { AppointmentReminderService } from './appointment-reminder.service';
import { MailSenderService } from 'src/user-otp/mail-sender.service';
import { MobileSenderService } from 'src/user-otp/mobile-sender.service';
import { TransactionService } from 'src/wallet/services/transaction.service';
import { WalletModule } from 'src/wallet/wallet.module';
import { CompleteAppointmentUsecase } from './usecases/complete-appointment.usecase';
import { EightEightTokenService } from 'src/utils/8x8-token.service';
import { Prescription } from './models/prescription.entity';
import { DoctorSignature } from './models/doctor-signature.entity';
import { FindDoctorUseCase } from './usecases/find-doctor.usecase';
import { PushNotificationEvent } from 'src/users/events/push-notification.event';
import { ConsultationController } from './controllers/consultation.controller';
import { DoctorViewConsultationRequestUseCase } from './usecases/doctor-view-consultation-request.usecase';
import { ConsultationGateway } from './gateways/consultation.gateway';
import { CqrsModule } from '@nestjs/cqrs';
import { ConsultationGatewayService } from './gateways/consultation-gateway.service';
import { Transactions } from 'src/wallet/model/transaction.entity';
import { ManualFunding } from 'src/wallet/model/manual-funding.entity';
import { ConsultationRequestHandler } from './events/consultation-request.handler';
import { ConsultationNotificationService } from './services/consultation-notification.service';
import { ConsultationExpiryService } from './services/consultation-expiry.service';
import { CushyAiProviderModule } from 'src/cushy-ai/cushy-ai-provider.module';
import { HealthAiTriageService } from './services/health-ai-triage.service';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';

@Module({
  imports: [
    CommonModule,
    WalletModule,
    CqrsModule,
    CushyAiProviderModule,
    TypeOrmModule.forFeature([
      ProfessionDetails,
      ConsultationSchedule,
      Users,
      Appointment,
      Prescription,
      DoctorSignature,
      Transactions,
      Wallets,
      ManualFunding,
    ]),
  ],
  providers: [
    DoctorService,
    UploadDoctorDocumentsUseCase,
    AppointmentUseCase,
    SaveScheduleUseCase,
    CompleteAppointmentUsecase,
    S3Service,
    AppointmentReminderService,
    MailSenderService,
    MobileSenderService,
    EightEightTokenService,
    PushNotificationEvent,
    FindDoctorUseCase,
    ConsultationGatewayService,
    DoctorViewConsultationRequestUseCase,
    TransactionService,
    WalletService,
    ConsultationRequestHandler,
    ConsultationNotificationService,
    ConsultationExpiryService,
    HealthAiTriageService,

    // Custom provider for ConsultationGateway with useFactory
    {
      provide: ConsultationGateway,
      useFactory: (
        gatewayService: ConsultationGatewayService,
        doctorViewUseCase: DoctorViewConsultationRequestUseCase,
        jwtService: JwtService,
        dataSource: DataSource,
      ) => {
        return new ConsultationGateway(
          gatewayService,
          doctorViewUseCase,
          jwtService,
          dataSource,
        );
      },
      inject: [
        ConsultationGatewayService,
        DoctorViewConsultationRequestUseCase,
        JwtService,
        DataSource,
      ],
    },
  ],
  exports: [ConsultationGatewayService],
  controllers: [DoctorController, ConsultationController],
})
export class DoctorModule {}

// src/riders/usecases/update-rider-status.usecase.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EventBus } from '@nestjs/cqrs';
import { Rider, RiderStatus } from '../model/rider.entity';
import { RiderDocument, DocumentStatus } from '../model/rider-document.entity';
import { StandardResponse } from '../../common/module/standard-response';
import { CommonService } from '../../common/common.service';
import { MailSenderService } from '../../user-otp/mail-sender.service';
import { NotificationCategory } from 'src/users/model/notification-category';
import { PushNotificationEvent } from 'src/users/events/push-notification.event';
import { Users } from '../../users/model/users.entity';
import { lockRiderDocumentMutation } from '../rider-document-lock';
import { determineRiderClearanceStatus } from '../rider-clearance';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum RejectionReason {
  INCOMPLETE_DOCUMENTS = 'incomplete_documents',
  INVALID_LICENSE = 'invalid_license',
  BACKGROUND_CHECK_FAILED = 'background_check_failed',
  VEHICLE_NOT_COMPLIANT = 'vehicle_not_compliant',
  TRAINING_INCOMPLETE = 'training_incomplete',
  INSURANCE_EXPIRED = 'insurance_expired',
  OTHER = 'other',
}

export class StatusUpdateDto {
  @IsEnum(RiderStatus)
  status: RiderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsEnum(RejectionReason)
  rejectionReason?: RejectionReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  verifiedBy?: string;

  @IsOptional()
  @IsString()
  documentId?: string;

  @IsOptional()
  @IsEnum(DocumentStatus)
  documentStatus?: DocumentStatus;
}

@Injectable()
export class UpdateRiderStatusUseCase {
  private readonly logger = new Logger(UpdateRiderStatusUseCase.name);

  constructor(
    private readonly mailSenderService: MailSenderService,
    private readonly commonService: CommonService,
    private readonly dataSource: DataSource,
    private readonly eventBus: EventBus,
  ) {}

  async execute(
    riderId: string,
    statusUpdate: StatusUpdateDto,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    if (statusUpdate.documentId || statusUpdate.documentStatus) {
      throw new BadRequestException(
        new StandardResponse(true, 'USE_RIDER_DOCUMENT_REVIEW_ENDPOINT'),
      );
    }
    const trustedUpdate = {
      ...statusUpdate,
      verifiedBy: authenticatedUser.id,
    };
    const result = await this.dataSource.transaction(async (manager) => {
      await lockRiderDocumentMutation(manager, riderId);
      const rider = await manager.findOne(Rider, {
        where: { id: riderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!rider) {
        throw new NotFoundException(
          new StandardResponse(true, 'RIDER_NOT_FOUND'),
        );
      }
      const [user, documents] = await Promise.all([
        manager.findOne(Users, { where: { id: rider.userId } }),
        manager.find(RiderDocument, { where: { riderId } }),
      ]);
      rider.user = user;
      rider.documents = documents;
      const oldStatus = rider.status;
      this.validateStatusTransition(
        oldStatus,
        trustedUpdate.status,
        trustedUpdate,
      );

      switch (trustedUpdate.status) {
        case RiderStatus.ACTIVE:
          await this.handleActivation(rider, trustedUpdate, manager);
          break;

        case RiderStatus.REJECTED:
          await this.handleRejection(rider, trustedUpdate, manager);
          break;

        case RiderStatus.SUSPENDED:
          await this.handleSuspension(rider, trustedUpdate, manager);
          break;

        case RiderStatus.DOCUMENT_VERIFICATION:
          await this.handleDocumentVerification(rider, trustedUpdate, manager);
          break;

        case RiderStatus.BACKGROUND_CHECK:
          await this.handleBackgroundCheck(rider, trustedUpdate, manager);
          break;

        case RiderStatus.INACTIVE:
          await this.handleInactivation(rider, trustedUpdate, manager);
          break;

        default:
          rider.status = trustedUpdate.status;
          rider.metadata = {
            ...rider.metadata,
            lastStatusChange: {
              from: oldStatus,
              to: trustedUpdate.status,
              reason: trustedUpdate.reason,
              changedBy: authenticatedUser.id,
              changedAt: new Date(),
            },
          };
          await manager.save(Rider, rider);
      }
      return { rider, oldStatus };
    });

    try {
      this.eventBus.publish(
        new PushNotificationEvent(
          result.rider.userId,
          NotificationCategory.RIDER_STATUS_CHANGED,
          this.getStatusMessage(trustedUpdate.status),
        ),
      );
      await this.sendStatusNotifications(result.rider, trustedUpdate);
    } catch (error) {
      this.logger.warn(
        `Rider ${riderId} status changed, but its notification could not be sent: ${error?.message || error}`,
      );
    }

    return new StandardResponse(false, 'RIDER_STATUS_UPDATED_SUCCESSFULLY', {
      riderId: result.rider.id,
      oldStatus: result.oldStatus,
      newStatus: result.rider.status,
      message: this.getStatusMessage(trustedUpdate.status),
      nextSteps: this.getNextSteps(trustedUpdate.status),
      requiresAction: this.requiresAction(trustedUpdate.status),
    });
  }

  /**
   * Validate if status transition is allowed
   */
  private validateStatusTransition(
    oldStatus: RiderStatus,
    newStatus: RiderStatus,
    statusUpdate: StatusUpdateDto,
  ): void {
    // Define allowed transitions
    const allowedTransitions: Record<RiderStatus, RiderStatus[]> = {
      [RiderStatus.PENDING]: [
        RiderStatus.DOCUMENT_VERIFICATION,
        RiderStatus.BACKGROUND_CHECK,
        RiderStatus.REJECTED,
      ],
      [RiderStatus.DOCUMENT_VERIFICATION]: [
        RiderStatus.BACKGROUND_CHECK,
        RiderStatus.REJECTED,
        RiderStatus.PENDING,
      ],
      [RiderStatus.BACKGROUND_CHECK]: [
        RiderStatus.ACTIVE,
        RiderStatus.REJECTED,
        RiderStatus.PENDING,
      ],
      [RiderStatus.ACTIVE]: [RiderStatus.INACTIVE, RiderStatus.SUSPENDED],
      [RiderStatus.SUSPENDED]: [
        RiderStatus.ACTIVE,
        RiderStatus.INACTIVE,
        RiderStatus.REJECTED,
      ],
      [RiderStatus.INACTIVE]: [RiderStatus.ACTIVE, RiderStatus.SUSPENDED],
      [RiderStatus.REJECTED]: [RiderStatus.PENDING],
      [RiderStatus.TRAINING]: [RiderStatus.ACTIVE],
    };

    const allowed = allowedTransitions[oldStatus] || [];

    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        new StandardResponse(
          true,
          `INVALID_STATUS_TRANSITION_FROM_${oldStatus}_TO_${newStatus}`,
        ),
      );
    }

    // Require reason for certain transitions
    if (
      (newStatus === RiderStatus.REJECTED ||
        newStatus === RiderStatus.SUSPENDED) &&
      !statusUpdate.reason
    ) {
      throw new BadRequestException(
        new StandardResponse(
          true,
          'REASON_REQUIRED_FOR_REJECTION_OR_SUSPENSION',
        ),
      );
    }
  }

  /**
   * Handle rider activation
   */
  private async handleActivation(
    rider: Rider,
    statusUpdate: StatusUpdateDto,
    manager: any,
  ): Promise<void> {
    const requiredStatus = determineRiderClearanceStatus(
      rider,
      rider.documents || [],
    );
    if (requiredStatus !== RiderStatus.ACTIVE) {
      throw new BadRequestException(
        new StandardResponse(true, 'RIDER_CLEARANCE_INCOMPLETE', {
          requiredStatus,
        }),
      );
    }
    rider.status = RiderStatus.ACTIVE;
    rider.approvedBy = statusUpdate.verifiedBy;
    rider.approvedAt = new Date();
    rider.metadata = {
      ...rider.metadata,
      activatedAt: new Date(),
      activatedBy: statusUpdate.verifiedBy,
      activationNotes: statusUpdate.notes,
    };

    await manager.save(Rider, rider);
  }

  /**
   * Handle rider rejection
   */
  private async handleRejection(
    rider: Rider,
    statusUpdate: StatusUpdateDto,
    manager: any,
  ): Promise<void> {
    rider.status = RiderStatus.REJECTED;
    rider.rejectedReason = statusUpdate.reason;
    rider.metadata = {
      ...rider.metadata,
      rejectedAt: new Date(),
      rejectedBy: statusUpdate.verifiedBy,
      rejectionReason: statusUpdate.rejectionReason,
      rejectionNotes: statusUpdate.notes,
    };

    await manager.save(Rider, rider);
  }

  /**
   * Handle rider suspension
   */
  private async handleSuspension(
    rider: Rider,
    statusUpdate: StatusUpdateDto,
    manager: any,
  ): Promise<void> {
    // Force rider offline
    rider.isOnline = false;
    rider.status = RiderStatus.SUSPENDED;
    rider.metadata = {
      ...rider.metadata,
      suspendedAt: new Date(),
      suspendedBy: statusUpdate.verifiedBy,
      suspensionReason: statusUpdate.reason,
      suspensionNotes: statusUpdate.notes,
    };

    await manager.save(Rider, rider);
  }

  /**
   * Handle document verification stage
   */
  private async handleDocumentVerification(
    rider: Rider,
    statusUpdate: StatusUpdateDto,
    manager: any,
  ): Promise<void> {
    rider.status = RiderStatus.DOCUMENT_VERIFICATION;
    rider.metadata = {
      ...rider.metadata,
      documentVerificationStartedAt: new Date(),
      documentVerificationBy: statusUpdate.verifiedBy,
    };

    await manager.save(Rider, rider);
  }

  /**
   * Handle background check stage
   */
  private async handleBackgroundCheck(
    rider: Rider,
    statusUpdate: StatusUpdateDto,
    manager: any,
  ): Promise<void> {
    rider.status = RiderStatus.BACKGROUND_CHECK;
    rider.backgroundCheckStatus = 'in_progress';
    rider.metadata = {
      ...rider.metadata,
      backgroundCheckStartedAt: new Date(),
      backgroundCheckInitiatedBy: statusUpdate.verifiedBy,
    };

    await manager.save(Rider, rider);
  }

  /**
   * Handle inactivation
   */
  private async handleInactivation(
    rider: Rider,
    statusUpdate: StatusUpdateDto,
    manager: any,
  ): Promise<void> {
    rider.isOnline = false;
    rider.status = RiderStatus.INACTIVE;
    rider.metadata = {
      ...rider.metadata,
      inactivatedAt: new Date(),
      inactivatedBy: statusUpdate.verifiedBy,
      inactivationReason: statusUpdate.reason,
    };

    await manager.save(Rider, rider);
  }

  /**
   * Send notifications based on status change
   */
  private async sendStatusNotifications(
    rider: Rider,
    statusUpdate: StatusUpdateDto,
  ): Promise<void> {
    const user = rider.user;
    if (!user) return;

    let emailSubject = '';
    let emailTemplate = '';

    switch (statusUpdate.status) {
      case RiderStatus.ACTIVE:
        emailSubject = 'Welcome to CushyAccess - Your Rider Account is Active!';
        emailTemplate = 'rider-activated';
        break;

      case RiderStatus.REJECTED:
        emailSubject = 'Update on Your CushyAccess Rider Application';
        emailTemplate = 'rider-rejected';
        break;

      case RiderStatus.SUSPENDED:
        emailSubject =
          'Important: Your CushyAccess Rider Account Has Been Suspended';
        emailTemplate = 'rider-suspended';
        break;

      case RiderStatus.DOCUMENT_VERIFICATION:
        emailSubject = 'Action Required: Upload Your Documents';
        emailTemplate = 'rider-documents-required';
        break;

      case RiderStatus.TRAINING:
        emailSubject = 'Complete Your Rider Training';
        emailTemplate = 'rider-training-required';
        break;
    }

    // Send Email
    if (emailSubject && emailTemplate) {
      await this.mailSenderService.sendMail({
        recipient: user.email,
        subject: emailSubject,
        template: emailTemplate,
        content: {
          riderName: `${user.firstName} ${user.lastName}`,
          status: statusUpdate.status,
          reason: statusUpdate.reason,
          notes: statusUpdate.notes,
          nextSteps: this.getNextSteps(statusUpdate.status),
        },
      });
    }
  }

  /**
   * Get status-specific message
   */
  private getStatusMessage(status: RiderStatus): string {
    const messages: Record<RiderStatus, string> = {
      [RiderStatus.PENDING]: 'Application is pending review',
      [RiderStatus.DOCUMENT_VERIFICATION]: 'Documents are being verified',
      [RiderStatus.BACKGROUND_CHECK]: 'Background check in progress',
      [RiderStatus.TRAINING]: 'Training in progress',
      [RiderStatus.ACTIVE]: 'Account is active and ready for deliveries',
      [RiderStatus.SUSPENDED]: 'Account has been suspended',
      [RiderStatus.INACTIVE]: 'Account is inactive',
      [RiderStatus.REJECTED]: 'Application has been rejected',
    };
    return messages[status] || 'Status updated successfully';
  }

  /**
   * Get next steps based on status
   */
  private getNextSteps(status: RiderStatus): string[] {
    const steps: Record<RiderStatus, string[]> = {
      [RiderStatus.PENDING]: [
        'Wait for document verification',
        'Check email for updates',
      ],
      [RiderStatus.DOCUMENT_VERIFICATION]: [
        'Ensure all documents are clear and valid',
        'Check verification status daily',
      ],
      [RiderStatus.BACKGROUND_CHECK]: [
        'Background check typically takes 2-3 business days',
        'You will be notified when complete',
      ],
      [RiderStatus.TRAINING]: [
        'Complete all training modules',
        'Pass the assessment quiz',
      ],
      [RiderStatus.ACTIVE]: [
        'Go online to start receiving orders',
        'Maintain high acceptance rate',
      ],
      [RiderStatus.SUSPENDED]: [
        'Contact support for resolution',
        'Address the suspension reason',
      ],
      [RiderStatus.INACTIVE]: [
        'Go online to become active again',
        'Update availability if needed',
      ],
      [RiderStatus.REJECTED]: [
        'Review rejection reason',
        'Consider reapplying after 30 days',
      ],
    };
    return steps[status] || ['Contact support for guidance'];
  }

  /**
   * Check if status requires action from rider
   */
  private requiresAction(status: RiderStatus): boolean {
    const actionRequiredStatuses = [
      RiderStatus.DOCUMENT_VERIFICATION,
      RiderStatus.TRAINING,
      RiderStatus.SUSPENDED,
    ];
    return actionRequiredStatuses.includes(status);
  }
}

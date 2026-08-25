import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { Users } from 'src/users/model/users.entity';
import { PaystackService } from './paystack.service';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { Appointment } from '../../doctor/models/appointment.entity';
import { createPayoutReference } from '../utils/payout-reference';
import { VendorPayoutDetails } from 'src/users/model/vendor-payout.entity';
import { PayoutTransactions } from 'src/users/model/payout-transactions.entity';
import { PayoutStatus } from 'src/users/model/payout-status.enum';
import { Wallets } from '../model/wallet.entity';
import { StandardResponse } from 'src/common/module/standard-response';

const ACTIVE_PAYOUT_STATUSES = [PayoutStatus.PROCESSING, PayoutStatus.PENDING];
const UNSETTLED_PROVIDER_STATUSES = [
  'accepted',
  'pending',
  'received',
  'processing',
];
const PAYSTACK_BATCH_SIZE = 100;
const RECONCILIATION_MIN_AGE_MS = 2 * 60 * 1000;
const ABANDONED_PAYOUT_AGE_MS = 24 * 60 * 60 * 1000;
const ABANDONED_PAYOUT_ATTEMPTS = 6;

@Injectable()
export class DoctorPayoutService {
  private readonly logger = new Logger(DoctorPayoutService.name);

  constructor(
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,

    @InjectRepository(PayoutTransactions)
    private readonly payoutRepo: Repository<PayoutTransactions>,

    @InjectRepository(VendorPayoutDetails)
    private readonly detailsRepo: Repository<VendorPayoutDetails>,

    private readonly dataSource: DataSource,
    private readonly paystack: PaystackService,
  ) {}

  /**
   * Scheduled 11pm doctor settlement. Only the worker instance runs the
   * schedule (so it fires once). The work lives in runDoctorWalletPayouts()
   * so it can also be triggered manually from an admin endpoint.
   */
  @Cron(CronExpression.EVERY_DAY_AT_11PM)
  async runDoctorPayouts() {
    if (process.env.APP_ROLE !== 'worker') {
      this.logger.log(
        'Skipping scheduled doctor payout run - not a worker instance',
      );
      return;
    }
    return this.runDoctorWalletPayouts();
  }

  /**
   * Wallet-driven doctor settlement.
   *
   * The doctor's wallet is credited with 80% of each consultation at completion
   * (see CompleteAppointmentUsecase - the 20% platform fee is already removed
   * there). Here we simply pay every doctor their FULL current wallet balance
   * to their bank via Paystack. No fee is re-applied.
   *
   * The wallet is debited when Paystack acknowledges the submitted transfer;
   * later webhook/reconciliation failures compensate it atomically. Not gated by APP_ROLE, so it works
   * from the admin trigger on any process. A doctor with an in-flight (PENDING)
   * payout is skipped so overlapping triggers cannot double-pay.
   */
  async runDoctorWalletPayouts() {
    this.logger.log(
      'Running wallet-driven doctor payouts (settling all doctors with a positive balance)...',
    );

    try {
      this.paystack.assertConfigured();
      await this.reconcilePendingDoctorPayouts();
      const doctors = await this.usersRepo.find({
        where: { userRole: UserRoles.DOCTOR },
        relations: ['payoutDetails', 'wallet'],
      });

      // 1. Eligibility: positive balance, has bank details, no in-flight payout.
      const eligible: { doctor: Users; balance: number }[] = [];
      for (const doctor of doctors) {
        const balance = Number(doctor.wallet?.walletBalance || 0);
        if (balance <= 0) continue;

        if (!doctor.payoutDetails) {
          this.logger.log(
            `Doctor ${doctor.id} has a balance but no payout details - skipping`,
          );
          continue;
        }

        const inFlight = await this.payoutRepo.findOne({
          where: {
            vendor: { id: doctor.id },
            status: In(ACTIVE_PAYOUT_STATUSES),
          },
        });
        if (inFlight) {
          this.logger.warn(
            `Doctor ${doctor.id} already has an in-flight payout (${inFlight.reference}) - skipping to avoid double payment`,
          );
          continue;
        }

        eligible.push({ doctor, balance });
      }

      if (!eligible.length) {
        this.logger.log('No doctors with a positive wallet balance to settle.');
        return new StandardResponse(false, 'NO_ELIGIBLE_DOCTOR_PAYOUTS', {
          count: 0,
        });
      }

      // 2. Create Paystack recipients for any eligible doctor missing one.
      const uniqueRecipientKeys = new Set<string>();
      const recipientsToCreate = eligible
        .filter((e) => !e.doctor.payoutDetails.recipientCode)
        .filter((e) => {
          const key = this.recipientKey(
            e.doctor.payoutDetails.accountNumber,
            e.doctor.payoutDetails.bankCode,
          );
          if (uniqueRecipientKeys.has(key)) return false;
          uniqueRecipientKeys.add(key);
          return true;
        })
        .map((e) => ({
          name: e.doctor.payoutDetails.accountName,
          account_number: e.doctor.payoutDetails.accountNumber,
          bank_code: e.doctor.payoutDetails.bankCode,
          currency: 'NGN',
        }));

      const recipientOwners = new Map<
        string,
        Array<(typeof eligible)[number]>
      >();
      for (const entry of eligible.filter(
        (e) => !e.doctor.payoutDetails.recipientCode,
      )) {
        const key = this.recipientKey(
          entry.doctor.payoutDetails.accountNumber,
          entry.doctor.payoutDetails.bankCode,
        );
        const owners = recipientOwners.get(key) || [];
        owners.push(entry);
        recipientOwners.set(key, owners);
      }

      for (const recipientBatch of this.chunk(
        recipientsToCreate,
        PAYSTACK_BATCH_SIZE,
      )) {
        try {
          this.logger.log(
            `Creating ${recipientBatch.length} bulk recipients for doctors...`,
          );
          const res =
            await this.paystack.createBulkTransferRecipient(recipientBatch);

          for (const recipient of res?.data?.success || []) {
            const key = this.recipientKey(
              recipient.details.account_number,
              recipient.details.bank_code,
            );
            const matches = recipientOwners.get(key) || [];
            if (matches.length) {
              const details = matches.map(({ doctor }) => {
                doctor.payoutDetails.recipientCode = recipient.recipient_code;
                return doctor.payoutDetails;
              });
              await this.detailsRepo.save(details);
              recipientOwners.delete(key);
            }
          }
        } catch (error: unknown) {
          this.logger.error(
            'Doctor recipient creation failed',
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      // 3. Build the transfer payload + a PENDING payout record per doctor.
      const transfersPayload: Array<{
        amount: number;
        recipient: string;
        reason: string;
        reference: string;
      }> = [];
      const localTxns: PayoutTransactions[] = [];

      for (const { doctor } of eligible) {
        const details = doctor.payoutDetails;
        if (!details.recipientCode) {
          this.logger.warn(
            `Doctor ${doctor.id} still has no recipient code - skipping`,
          );
          continue;
        }

        const reference = createPayoutReference('dpayout');

        const txn = await this.dataSource.transaction(async (manager) => {
          const wallet = await manager.findOne(Wallets, {
            where: { userId: doctor.id },
            lock: { mode: 'pessimistic_write' },
          });
          const currentBalance = Number(wallet?.walletBalance || 0);
          if (currentBalance <= 0) return null;

          const inFlight = await manager.findOne(PayoutTransactions, {
            where: {
              vendor: { id: doctor.id },
              status: In(ACTIVE_PAYOUT_STATUSES),
            },
          });
          if (inFlight) return null;

          const amount = Number(currentBalance.toFixed(2));
          return manager.save(
            PayoutTransactions,
            manager.create(PayoutTransactions, {
              vendor: doctor,
              amount,
              reference,
              status: PayoutStatus.PENDING,
              bankName: details.bankName,
              accountNumber: details.accountNumber,
              accountName: details.accountName,
              providerReference: '',
              narration: `Doctor wallet settlement of NGN${amount}`,
              orderIds: null,
            }),
          );
        });
        if (!txn) continue;

        transfersPayload.push({
          amount: Math.round(Number(txn.amount) * 100), // kobo
          recipient: details.recipientCode,
          reason: txn.narration,
          reference,
        });
        localTxns.push(txn);
      }

      if (!transfersPayload.length) {
        this.logger.log(
          'No eligible doctor payouts after recipient resolution.',
        );
        return new StandardResponse(false, 'NO_ELIGIBLE_DOCTOR_PAYOUTS', {
          count: 0,
        });
      }

      const batches = this.chunk(transfersPayload, PAYSTACK_BATCH_SIZE);
      let acknowledged = 0;
      for (const batch of batches) {
        try {
          const result = await this.paystack.initiateBulkTransfer(batch);
          this.assertBulkSubmissionAccepted(result);
          const byReference = new Map(
            (Array.isArray(result.data) ? result.data : []).map((item) => [
              item.reference,
              item,
            ]),
          );
          for (const transfer of batch) {
            const providerResult = byReference.get(transfer.reference);
            if (!providerResult) {
              await this.markSubmissionAmbiguous(
                transfer.reference,
                'Paystack response did not contain this doctor transfer',
              );
              continue;
            }
            await this.applyProviderStatus(
              transfer.reference,
              providerResult.status,
              providerResult.transfer_code,
              true,
            );
            acknowledged += 1;
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          const responseStatus = this.getHttpResponseStatus(error);
          if (this.isDefinitiveSubmissionFailure(responseStatus)) {
            await Promise.all(
              batch.map((transfer) =>
                this.updateDoctorPayoutStatus(
                  transfer.reference,
                  PayoutStatus.FAILED,
                  `http_${responseStatus}`,
                  undefined,
                  `Provider rejected doctor payout: ${message}`.slice(0, 255),
                ),
              ),
            );
          } else {
            await Promise.all(
              batch.map((transfer) =>
                this.markSubmissionAmbiguous(transfer.reference, message),
              ),
            );
          }
        }
      }

      return new StandardResponse(false, 'DOCTOR_PAYOUTS_INITIATED', {
        message: `Created ${localTxns.length} doctor wallet settlement(s)`,
        count: localTxns.length,
        acknowledgedCount: acknowledged,
        totalAmount: localTxns.reduce((sum, tx) => sum + Number(tx.amount), 0),
      });
    } catch (error: any) {
      this.logger.error('Error running doctor payouts:', error);
      return new StandardResponse(true, 'DOCTOR_PAYOUT_ERROR', {
        error: error.message,
      });
    }
  }

  /**
   * Provider-driven status update for doctor payouts (references start dpayout-).
   * Idempotent (ignores duplicate webhook retries, debits only on the first move
   * into APPROVED) and atomic (SQL decrement avoids lost updates vs. a concurrent
   * consultation credit).
   */
  async updateDoctorPayoutStatus(
    reference: string,
    status: PayoutStatus,
    providerStatus?: string,
    providerReference?: string,
    remark?: string,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const payout = await manager.findOne(PayoutTransactions, {
        where: { reference },
        relations: ['vendor'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!payout) return;

      if (payout.status === status) {
        this.logger.log(
          `Doctor payout ${reference} already ${status}; ignoring duplicate provider event`,
        );
        if (providerStatus) payout.providerStatus = providerStatus;
        if (providerReference) payout.providerReference = providerReference;
        payout.lastReconciledAt = new Date();
        await manager.save(PayoutTransactions, payout);
        return;
      }

      const wasApproved = payout.status === PayoutStatus.APPROVED;

      if (
        wasApproved &&
        status !== PayoutStatus.FAILED &&
        status !== PayoutStatus.REVERSED
      )
        return;
      if (payout.status === PayoutStatus.REVERSED) return;
      if (
        payout.status === PayoutStatus.FAILED &&
        status !== PayoutStatus.APPROVED &&
        status !== PayoutStatus.REVERSED
      )
        return;

      payout.status = status;
      payout.providerStatus = providerStatus || payout.providerStatus;
      payout.providerReference = providerReference || payout.providerReference;
      if (remark) payout.remark = remark;
      payout.lastReconciledAt = new Date();
      payout.updatedAt = new Date();
      await manager.save(PayoutTransactions, payout);
      this.logger.log(`Doctor payout ${reference} updated to ${status}`);

      if (status === PayoutStatus.APPROVED && !wasApproved) {
        const amount = Number(payout.amount);

        const walletUpdate = await manager.decrement(
          Wallets,
          { userId: payout.vendor.id },
          'walletBalance',
          amount,
        );
        if (walletUpdate.affected !== 1) {
          throw new Error(`Wallet update failed for payout ${reference}`);
        }
        this.logger.log(
          `💸 Settled ₦${amount.toFixed(2)} for doctor ${payout.vendor.id} (payout ${reference})`,
        );

        if (payout.orderIds && payout.orderIds.length) {
          await manager.update(
            Appointment,
            { id: In(payout.orderIds) },
            { isPaidOut: true },
          );
          this.logger.log(
            `Marked ${payout.orderIds.length} appointments as paid for payout ${reference}`,
          );
        }
      }

      if (
        (status === PayoutStatus.FAILED ||
          status === PayoutStatus.REVERSED) &&
        wasApproved
      ) {
        const amount = Number(payout.amount);
        const walletUpdate = await manager.increment(
          Wallets,
          { userId: payout.vendor.id },
          'walletBalance',
          amount,
        );
        if (walletUpdate.affected !== 1) {
          throw new Error(`Wallet update failed for payout ${reference}`);
        }
        if (payout.orderIds?.length) {
          await manager.update(
            Appointment,
            { id: In(payout.orderIds) },
            { isPaidOut: false },
          );
        }
      }
    });
  }

  @Cron('30 */10 * * * *')
  async scheduledDoctorPayoutReconciliation() {
    if (process.env.APP_ROLE !== 'worker') return;
    await this.reconcilePendingDoctorPayouts();
  }

  async reconcilePendingDoctorPayouts(limit = 100) {
    const cutoff = new Date(Date.now() - RECONCILIATION_MIN_AGE_MS);
    const doctor = { userRole: UserRoles.DOCTOR };
    const payouts = await this.payoutRepo.find({
      where: [
        {
          status: In(ACTIVE_PAYOUT_STATUSES),
          createdAt: LessThan(cutoff),
          vendor: doctor,
        },
        {
          status: PayoutStatus.APPROVED,
          providerStatus: In(UNSETTLED_PROVIDER_STATUSES),
          createdAt: LessThan(cutoff),
          vendor: doctor,
        },
      ],
      relations: ['vendor'],
      order: { createdAt: 'ASC' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    let reconciled = 0;
    for (const payout of payouts) {
      try {
        const result = await this.paystack.verifyTransfer(payout.reference);
        if (!result?.data?.status) {
          throw new Error('Provider verification returned no transfer status');
        }
        await this.applyProviderStatus(
          payout.reference,
          result.data.status,
          result.data.transfer_code,
        );
        reconciled += 1;
      } catch (error: unknown) {
        const statusCode = this.getHttpResponseStatus(error);
        const message = error instanceof Error ? error.message : String(error);
        const current = await this.recordReconciliationFailure(
          payout.id,
          message,
        );
        if (
          current.active &&
          statusCode === 404 &&
          Date.now() - current.createdAt.getTime() >= ABANDONED_PAYOUT_AGE_MS &&
          current.attempts >= ABANDONED_PAYOUT_ATTEMPTS
        ) {
          await this.updateDoctorPayoutStatus(
            payout.reference,
            PayoutStatus.FAILED,
            'not_found',
          );
        }
      }
    }
    return { checked: payouts.length, reconciled };
  }

  private async applyProviderStatus(
    reference: string,
    providerStatus?: string,
    providerReference?: string,
    submissionAcknowledged = false,
  ) {
    const normalized = (
      providerStatus || (submissionAcknowledged ? 'accepted' : 'pending')
    ).toLowerCase();
    let status = submissionAcknowledged
      ? PayoutStatus.APPROVED
      : PayoutStatus.PENDING;
    if (normalized === 'success') status = PayoutStatus.APPROVED;
    if (['failed', 'rejected', 'abandoned'].includes(normalized)) {
      status = PayoutStatus.FAILED;
    }
    if (normalized === 'reversed') status = PayoutStatus.REVERSED;
    await this.updateDoctorPayoutStatus(
      reference,
      status,
      normalized,
      providerReference,
    );
  }

  private assertBulkSubmissionAccepted(result: {
    status?: boolean;
    message?: string;
  }) {
    if (result?.status === true) return;
    const error = new Error(
      result?.message || 'Paystack rejected the bulk transfer submission',
    ) as Error & { response?: { status: number } };
    error.response = { status: 422 };
    throw error;
  }

  private async markSubmissionAmbiguous(reference: string, reason: string) {
    await this.payoutRepo.update(
      { reference, status: In(ACTIVE_PAYOUT_STATUSES) },
      {
        providerStatus: 'unknown',
        remark: `Submission outcome requires reconciliation: ${reason}`.slice(
          0,
          255,
        ),
      },
    );
  }

  private async recordReconciliationFailure(id: string, message: string) {
    return this.dataSource.transaction(async (manager) => {
      const payout = await manager.findOne(PayoutTransactions, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      const isUnsettledApproval =
        payout?.status === PayoutStatus.APPROVED &&
        UNSETTLED_PROVIDER_STATUSES.includes(payout.providerStatus || '');
      if (
        !payout ||
        (!ACTIVE_PAYOUT_STATUSES.includes(payout.status) &&
          !isUnsettledApproval)
      ) {
        return {
          active: false as const,
          attempts: payout?.reconciliationAttempts || 0,
          createdAt: payout?.createdAt || new Date(),
        };
      }
      payout.reconciliationAttempts = (payout.reconciliationAttempts || 0) + 1;
      payout.lastReconciledAt = new Date();
      payout.remark = `Reconciliation pending: ${message}`.slice(0, 255);
      await manager.save(PayoutTransactions, payout);
      return {
        active: true as const,
        attempts: payout.reconciliationAttempts,
        createdAt: payout.createdAt,
      };
    });
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private recipientKey(accountNumber: string, bankCode: string) {
    return `${bankCode}:${accountNumber}`;
  }

  private getHttpResponseStatus(error: unknown) {
    return (error as { response?: { status?: number } })?.response?.status;
  }

  private isDefinitiveSubmissionFailure(status?: number) {
    return Boolean(
      status &&
      status >= 400 &&
      status < 500 &&
      ![408, 409, 425, 429].includes(status),
    );
  }

  // Fetch payout history for a specific doctor
  async getDoctorPayouts(doctorId: string) {
    return await this.payoutRepo.find({
      where: { vendor: { id: doctorId } },
      order: { createdAt: 'DESC' },
    });
  }
  async fetchAllDoctorsPayouts(filters?: {
    doctorId?: string; // instead of vendorId
    status?: PayoutStatus;
    startDate?: Date;
    endDate?: Date;
    minAmount?: number;
    maxAmount?: number;
    bankName?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const query = this.payoutRepo
      .createQueryBuilder('payout')
      .leftJoinAndSelect('payout.vendor', 'vendor')
      .leftJoinAndSelect('vendor.professionDetails', 'professionDetails')
      .where('vendor.userRole = :role', { role: UserRoles.DOCTOR })
      .orderBy('payout.createdAt', 'DESC');

    if (filters?.doctorId) {
      query.andWhere('vendor.id = :doctorId', { doctorId: filters.doctorId });
    }

    if (filters?.status) {
      query.andWhere('payout.status = :status', { status: filters.status });
    }

    if (filters?.startDate) {
      query.andWhere('payout.createdAt >= :startDate', {
        startDate: filters.startDate,
      });
    }

    if (filters?.endDate) {
      query.andWhere('payout.createdAt <= :endDate', {
        endDate: filters.endDate,
      });
    }

    if (filters?.minAmount) {
      query.andWhere('payout.amount >= :minAmount', {
        minAmount: filters.minAmount,
      });
    }

    if (filters?.maxAmount) {
      query.andWhere('payout.amount <= :maxAmount', {
        maxAmount: filters.maxAmount,
      });
    }

    if (filters?.bankName) {
      query.andWhere('payout.bankName LIKE :bankName', {
        bankName: `%${filters.bankName}%`,
      });
    }

    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      query.andWhere(
        `(LOWER(vendor.firstName) LIKE :search OR
          LOWER(vendor.lastName) LIKE :search OR
          LOWER(vendor.email) LIKE :search OR
          LOWER(payout.reference) LIKE :search OR
          LOWER(payout.accountName) LIKE :search OR
          LOWER(payout.bankName) LIKE :search OR
          LOWER(payout.accountNumber) LIKE :search OR
          LOWER(professionDetails.specialty) LIKE :search)`,
        { search: `%${searchLower}%` },
      );
    }

    // Pagination
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;

    query.skip(skip).take(limit);

    const [data, total] = await query.getManyAndCount();

    return new StandardResponse(false, 'DOCTOR_PAYOUTS_FETCHED', {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  }
}

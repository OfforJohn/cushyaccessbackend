import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThan, Repository } from 'typeorm';
import { Users } from 'src/users/model/users.entity';
import { PaystackService } from './paystack.service';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { Orders } from 'src/orders/model/order.entity';
import { VendorPayoutDetails } from 'src/users/model/vendor-payout.entity';
import { PayoutTransactions } from 'src/users/model/payout-transactions.entity';
import { PayoutStatus } from 'src/users/model/payout-status.enum';
import { Wallets } from '../model/wallet.entity';
import { StandardResponse } from 'src/common/module/standard-response';
import { Rider, PayoutSchedule } from 'src/riders/model/rider.entity';
import { createPayoutReference } from '../utils/payout-reference';

const ACTIVE_PAYOUT_STATUSES = [PayoutStatus.PROCESSING, PayoutStatus.PENDING];
const UNSETTLED_PROVIDER_STATUSES = [
  'accepted',
  'pending',
  'received',
  'processing',
];
const PAYSTACK_BATCH_SIZE = 100;
const PAYSTACK_BATCH_DELAY_MS = 5_000;
const RECONCILIATION_MIN_AGE_MS = 2 * 60 * 1000;
const ABANDONED_PAYOUT_AGE_MS = 24 * 60 * 60 * 1000;
const ABANDONED_PAYOUT_ATTEMPTS = 6;
const RECONCILIATION_REMARK = 'Awaiting provider confirmation.';

type PayoutQueryFilters = {
  vendorId?: string;
  status?: PayoutStatus;
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
  bankName?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'amount';
  sortOrder?: 'ASC' | 'DESC';
};

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    @InjectRepository(Users) private readonly usersRepo: Repository<Users>,
    @InjectRepository(PayoutTransactions)
    private readonly payoutRepo: Repository<PayoutTransactions>,
    @InjectRepository(VendorPayoutDetails)
    private readonly detailsRepo: Repository<VendorPayoutDetails>,
    @InjectRepository(Rider) private readonly riderRepo: Repository<Rider>,
    private readonly dataSource: DataSource,
    private readonly paystack: PaystackService,
  ) {}

  /**
   * Scheduled 11pm settlement. Only the worker instance runs the schedule
   * (so it fires once, not once per API cluster member). The actual work
   * lives in runWalletPayouts() so it can also be triggered manually.
   */
  @Cron(CronExpression.EVERY_DAY_AT_11PM, { timeZone: 'Africa/Lagos' })
  async runDailyPayouts() {
    if (process.env.APP_ROLE !== 'worker') {
      this.logger.log('Skipping scheduled payout run - not a worker instance');
      return;
    }
    await this.runWalletPayouts();
    await this.runRiderPayouts();
  }

  /**
   * Wallet-driven settlement.
   *
   * The merchant's Cushcoin wallet is the single source of truth: it is
   * credited with 95% of each order at delivery (see UpdateOrderTrackingUseCase).
   * Here we simply pay every merchant their FULL current wallet balance to
   * their bank via Paystack. The amount is already net of the 5% platform fee,
   * so no commission is re-applied.
   *
   * The amount is reserved atomically before Paystack submission. A successful
   * provider result finalizes that reservation; failure or reversal releases
   * it. Ambiguous transport outcomes remain reserved until reconciliation.
   *
   * Safe to call from the cron OR directly from an admin endpoint (it is NOT
   * gated by APP_ROLE). A vendor with an in-flight (PENDING) payout is skipped,
   * so overlapping triggers (e.g. admin button + 11pm cron) cannot double-pay.
   */
  async runWalletPayouts() {
    this.logger.log(
      'Running wallet-driven payouts (settling all merchants with a positive balance)...',
    );

    try {
      // Fail before any wallet reservation if provider credentials are absent.
      this.paystack.assertConfigured();

      // Resolve older ambiguous submissions before creating another settlement.
      await this.reconcilePendingPayouts();

      const vendors = await this.usersRepo.find({
        where: { userRole: UserRoles.VENDOR },
        relations: ['payoutDetails', 'wallet'],
      });
      const activePayouts = vendors.length
        ? await this.payoutRepo.find({
            where: {
              vendor: { id: In(vendors.map((vendor) => vendor.id)) },
              status: In(ACTIVE_PAYOUT_STATUSES),
            },
            relations: ['vendor'],
          })
        : [];
      const activeVendorIds = new Set(
        activePayouts.map((payout) => payout.vendor.id),
      );

      // 1. Determine who is eligible: positive balance, has bank details, and
      //    has no payout already in flight (idempotency guard).
      const eligible: { vendor: Users; balance: number }[] = [];
      for (const vendor of vendors) {
        const balance = Number(vendor.wallet?.walletBalance || 0);
        if (balance <= 0) continue;

        if (!vendor.payoutDetails) {
          this.logger.log(
            `Vendor ${vendor.id} has a balance but no payout details - skipping`,
          );
          continue;
        }

        if (activeVendorIds.has(vendor.id)) {
          this.logger.warn(
            `Vendor ${vendor.id} already has an in-flight payout - skipping to avoid double payment`,
          );
          continue;
        }

        eligible.push({ vendor, balance });
      }

      if (!eligible.length) {
        this.logger.log(
          'No merchants with a positive wallet balance to settle.',
        );
        return new StandardResponse(false, 'NO_ELIGIBLE_PAYOUTS', { count: 0 });
      }

      // 2. Create Paystack recipients for any eligible vendor missing one.
      const uniqueRecipientKeys = new Set<string>();
      const recipientsToCreate = eligible
        .filter((e) => !e.vendor.payoutDetails.recipientCode)
        .filter((e) => {
          const key = this.recipientKey(
            e.vendor.payoutDetails.accountNumber,
            e.vendor.payoutDetails.bankCode,
          );
          if (uniqueRecipientKeys.has(key)) return false;
          uniqueRecipientKeys.add(key);
          return true;
        })
        .map((e) => ({
          name: e.vendor.payoutDetails.accountName,
          account_number: e.vendor.payoutDetails.accountNumber,
          bank_code: e.vendor.payoutDetails.bankCode,
          currency: 'NGN',
        }));
      const recipientOwners = new Map<string, typeof eligible>();
      for (const entry of eligible) {
        if (entry.vendor.payoutDetails.recipientCode) continue;
        const key = this.recipientKey(
          entry.vendor.payoutDetails.accountNumber,
          entry.vendor.payoutDetails.bankCode,
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
            `Creating ${recipientBatch.length} bulk recipients...`,
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
              const details = matches.map(({ vendor }) => {
                vendor.payoutDetails.recipientCode = recipient.recipient_code;
                return vendor.payoutDetails;
              });
              await this.detailsRepo.save(details);
              recipientOwners.delete(key);
            }
          }
        } catch (error: unknown) {
          this.logger.error(
            'Recipient creation failed',
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      // 3. Reserve each merchant balance and create a PROCESSING record. Funds
      // remain reserved until a terminal provider result is received.
      const transfersPayload: Array<{
        amount: number;
        recipient: string;
        reason: string;
        reference: string;
      }> = [];
      const localTxns: PayoutTransactions[] = [];

      for (const { vendor } of eligible) {
        const details = vendor.payoutDetails;
        if (!details.recipientCode) {
          this.logger.warn(
            `Vendor ${vendor.id} still has no recipient code - skipping`,
          );
          continue;
        }

        const reference = createPayoutReference('payout');
        const txn = await this.dataSource.transaction(async (manager) => {
          const wallet = await manager.findOne(Wallets, {
            where: { userId: vendor.id },
            lock: { mode: 'pessimistic_write' },
          });
          const currentBalance = Number(wallet?.walletBalance || 0);
          if (currentBalance <= 0) return null;

          const inFlight = await manager.findOne(PayoutTransactions, {
            where: {
              vendor: { id: vendor.id },
              status: In(ACTIVE_PAYOUT_STATUSES),
            },
          });
          if (inFlight) {
            this.logger.warn(
              `Vendor ${vendor.id} already has an in-flight payout (${inFlight.reference}) - skipping after lock`,
            );
            return null;
          }

          const amount = Number(currentBalance.toFixed(2));
          const pendingPayout = manager.create(PayoutTransactions, {
            vendor,
            amount,
            reference,
            status: PayoutStatus.PROCESSING,
            bankName: details.bankName,
            accountNumber: details.accountNumber,
            accountName: details.accountName,
            providerReference: '',
            narration: `Wallet settlement of NGN${amount}`,
            orderIds: null,
            fundsReserved: true,
            reconciliationAttempts: 0,
          });
          const saved = await manager.save(PayoutTransactions, pendingPayout);
          const reservation = await manager.decrement(
            Wallets,
            { id: wallet.id },
            'walletBalance',
            amount,
          );
          if (reservation.affected !== 1) {
            throw new Error(`Unable to reserve wallet funds for ${vendor.id}`);
          }
          return saved;
        });

        if (!txn) continue;

        const amount = Number(txn.amount);

        transfersPayload.push({
          amount: Math.round(amount * 100), // kobo
          recipient: details.recipientCode,
          reason: txn.narration,
          reference,
        });
        localTxns.push(txn);
      }

      if (!transfersPayload.length) {
        this.logger.log('No eligible payouts after recipient resolution.');
        return new StandardResponse(false, 'NO_ELIGIBLE_PAYOUTS', { count: 0 });
      }

      // 4. Keep provider payloads bounded to 100 transfers per request. A
      // transport error is ambiguous, so funds stay reserved and reconciliation
      // verifies each reference before any retry is allowed.
      const batches = this.chunk(transfersPayload, PAYSTACK_BATCH_SIZE);
      let acknowledged = 0;
      let accepted = 0;
      let failed = 0;
      let ambiguous = 0;
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex];
        try {
          const result = await this.paystack.initiateBulkTransfer(batch);
          this.assertBulkSubmissionAccepted(result);
          const providerResults = Array.isArray(result?.data)
            ? result.data
            : [];

          for (const transfer of batch) {
            const providerResult = providerResults.find(
              (item) => item.reference === transfer.reference,
            );
            if (!providerResult) {
              ambiguous += 1;
              await this.markSubmissionAmbiguous(
                transfer.reference,
                'Paystack response did not contain this transfer reference',
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
            const normalizedStatus = (
              providerResult.status || ''
            ).toLowerCase();
            if (
              ['failed', 'rejected', 'abandoned', 'reversed'].includes(
                normalizedStatus,
              )
            ) {
              failed += 1;
            } else {
              accepted += 1;
            }
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          const responseStatus = this.getHttpResponseStatus(error);
          if (this.isDefinitiveSubmissionFailure(responseStatus)) {
            failed += batch.length;
            this.logger.error(
              `Bulk transfer batch ${batchIndex + 1} rejected by provider: ${message}`,
            );
            await Promise.all(
              batch.map((transfer) =>
                this.updateStatus(
                  transfer.reference,
                  PayoutStatus.FAILED,
                  `http_${responseStatus}`,
                  undefined,
                  `Provider rejected submission: ${message}`.slice(0, 255),
                ),
              ),
            );
          } else {
            ambiguous += batch.length;
            this.logger.error(
              `Bulk transfer batch ${batchIndex + 1} outcome unknown: ${message}`,
            );
            await Promise.all(
              batch.map((transfer) =>
                this.markSubmissionAmbiguous(transfer.reference, message),
              ),
            );
          }
        }

        if (batchIndex < batches.length - 1) {
          await this.delay(PAYSTACK_BATCH_DELAY_MS);
        }
      }

      this.logger.log(
        `Payout results: ${accepted} accepted, ${failed} failed, ${ambiguous} awaiting reconciliation`,
      );
      return new StandardResponse(false, 'PAYOUTS_INITIATED', {
        message: `Created ${localTxns.length} settlement(s): ${accepted} accepted, ${failed} failed, ${ambiguous} awaiting reconciliation`,
        count: localTxns.length,
        acknowledgedCount: acknowledged,
        acceptedCount: accepted,
        failedCount: failed,
        ambiguousCount: ambiguous,
        totalAmount: localTxns.reduce((sum, tx) => sum + Number(tx.amount), 0),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        'Error running payouts',
        error instanceof Error ? error.stack : message,
      );
      return new StandardResponse(true, 'PAYOUT_ERROR', { error: message });
    }
  }

  @Cron('0 */10 * * * *')
  async scheduledPayoutReconciliation() {
    if (process.env.APP_ROLE !== 'worker') return;
    await this.reconcilePendingPayouts();
  }

  async reconcilePendingPayouts(limit = 100) {
    const cutoff = new Date(Date.now() - RECONCILIATION_MIN_AGE_MS);
    const eligibleVendors = {
      userRole: In([UserRoles.VENDOR, UserRoles.RIDER]),
    };
    const payouts = await this.payoutRepo.find({
      where: [
        {
          status: In(ACTIVE_PAYOUT_STATUSES),
          createdAt: LessThan(cutoff),
          vendor: eligibleVendors,
        },
        {
          status: PayoutStatus.APPROVED,
          providerStatus: In(UNSETTLED_PROVIDER_STATUSES),
          createdAt: LessThan(cutoff),
          vendor: eligibleVendors,
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
        const providerTransfer = result?.data;
        if (!providerTransfer?.status) {
          throw new Error('Provider verification returned no transfer status');
        }
        await this.applyProviderStatus(
          payout.reference,
          providerTransfer.status,
          providerTransfer.transfer_code,
        );
        reconciled += 1;
      } catch (error: unknown) {
        const statusCode = (error as { response?: { status?: number } })
          ?.response?.status;
        const message = error instanceof Error ? error.message : String(error);
        const failure = await this.recordReconciliationFailure(
          payout.id,
          message,
        );
        if (!failure.active) continue;

        const oldEnough =
          Date.now() - failure.createdAt.getTime() >= ABANDONED_PAYOUT_AGE_MS;
        if (
          statusCode === 404 &&
          oldEnough &&
          failure.attempts >= ABANDONED_PAYOUT_ATTEMPTS
        ) {
          await this.updateStatus(
            payout.reference,
            PayoutStatus.FAILED,
            'not_found',
          );
          this.logger.warn(
            `Released abandoned payout ${payout.reference} after ${failure.attempts} provider checks`,
          );
        }
      }
    }

    return new StandardResponse(false, 'PAYOUT_RECONCILIATION_COMPLETED', {
      checked: payouts.length,
      reconciled,
    });
  }

  private async markSubmissionAmbiguous(reference: string, reason: string) {
    this.logger.warn(
      `Payout ${reference} requires provider reconciliation: ${reason}`,
    );
    await this.payoutRepo.update(
      { reference, status: In(ACTIVE_PAYOUT_STATUSES) },
      {
        providerStatus: 'unknown',
        remark: RECONCILIATION_REMARK,
      },
    );
  }

  private async recordReconciliationFailure(id: string, message: string) {
    this.logger.warn(`Payout ${id} reconciliation attempt failed: ${message}`);
    return this.dataSource.transaction(async (manager) => {
      const payout = await this.lockPayoutRow(manager, 'id', id);
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
      payout.remark = RECONCILIATION_REMARK;
      await manager.save(PayoutTransactions, payout);

      return {
        active: true as const,
        attempts: payout.reconciliationAttempts,
        createdAt: payout.createdAt,
      };
    });
  }

  /**
   * PostgreSQL cannot apply an unqualified FOR UPDATE to the nullable side of
   * a LEFT JOIN. Limit the lock to the payout alias, then hydrate relations in
   * a separate query while this transaction continues to hold that row lock.
   */
  private lockPayoutRow(
    manager: EntityManager,
    column: 'id' | 'reference',
    value: string,
  ) {
    return manager
      .createQueryBuilder(PayoutTransactions, 'payout')
      .where(`payout.${column} = :value`, { value })
      .setLock('pessimistic_write', undefined, ['payout'])
      .getOne();
  }

  private isReconciliationRemark(remark?: string | null) {
    if (!remark) return false;
    return (
      remark === RECONCILIATION_REMARK ||
      remark.startsWith('Reconciliation pending:') ||
      remark.startsWith('Submission outcome requires reconciliation:')
    );
  }

  private applyResolvedRemark(
    payout: PayoutTransactions,
    status: PayoutStatus,
    remark?: string,
  ) {
    if (remark) {
      payout.remark = remark;
      return;
    }
    if (
      [
        PayoutStatus.APPROVED,
        PayoutStatus.FAILED,
        PayoutStatus.REVERSED,
      ].includes(status) &&
      this.isReconciliationRemark(payout.remark)
    ) {
      payout.remark = null;
    }
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

    await this.updateStatus(reference, status, normalized, providerReference);
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

  /**
   * Provider-driven status update for vendor and rider payouts.
   *
   * Idempotent: Paystack retries webhooks, so each real transition applies its
   * wallet effect once. Reserved funds are finalized on success and restored
   * on a definitive failure or reversal.
   */
  async updateStatus(
    reference: string,
    status: PayoutStatus,
    providerStatus?: string,
    providerReference?: string,
    remark?: string,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const lockedPayout = await this.lockPayoutRow(
        manager,
        'reference',
        reference,
      );
      if (!lockedPayout) {
        this.logger.warn(
          `Ignoring provider event for unknown payout ${reference}`,
        );
        return;
      }
      const payout =
        (await manager.findOne(PayoutTransactions, {
          where: { reference },
          relations: ['vendor'],
        })) || lockedPayout;

      if (payout.status === status) {
        if (providerStatus) payout.providerStatus = providerStatus;
        if (providerReference) payout.providerReference = providerReference;
        this.applyResolvedRemark(payout, status, remark);
        payout.lastReconciledAt = new Date();
        await manager.save(PayoutTransactions, payout);
        this.logger.log(
          `Payout ${reference} already ${status}; ignoring duplicate provider event`,
        );
        return;
      }

      if (
        payout.status === PayoutStatus.APPROVED &&
        status !== PayoutStatus.FAILED &&
        status !== PayoutStatus.REVERSED
      ) {
        this.logger.warn(
          `Ignoring non-terminal transition ${payout.status} -> ${status} for ${reference}`,
        );
        return;
      }
      if (payout.status === PayoutStatus.REVERSED) return;
      if (
        payout.status === PayoutStatus.FAILED &&
        status !== PayoutStatus.APPROVED &&
        status !== PayoutStatus.REVERSED
      ) {
        return;
      }

      const mustApplyFunds =
        status === PayoutStatus.APPROVED && !payout.fundsReserved;
      const mustReleaseFunds =
        (status === PayoutStatus.FAILED || status === PayoutStatus.REVERSED) &&
        payout.fundsReserved;

      if (mustApplyFunds || mustReleaseFunds) {
        const wallet = await manager.findOne(Wallets, {
          where: { userId: payout.vendor.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!wallet)
          throw new Error(`Wallet not found for payout ${reference}`);

        const amount = Number(payout.amount);
        const walletUpdate = mustApplyFunds
          ? await manager.decrement(
              Wallets,
              { id: wallet.id },
              'walletBalance',
              amount,
            )
          : await manager.increment(
              Wallets,
              { id: wallet.id },
              'walletBalance',
              amount,
            );
        if (walletUpdate.affected !== 1) {
          throw new Error(`Wallet update failed for payout ${reference}`);
        }

        payout.fundsReserved = mustApplyFunds;
        if (mustReleaseFunds) payout.fundsReleasedAt = new Date();
      }

      payout.status = status;
      payout.providerStatus = providerStatus || payout.providerStatus;
      payout.providerReference = providerReference || payout.providerReference;
      this.applyResolvedRemark(payout, status, remark);
      payout.lastReconciledAt = new Date();
      payout.updatedAt = new Date();
      await manager.save(PayoutTransactions, payout);
      this.logger.log(`Payout ${reference} updated to ${status}`);

      if (status === PayoutStatus.APPROVED) {
        if (payout.orderIds && payout.orderIds.length) {
          await manager.update(
            Orders,
            { id: In(payout.orderIds) },
            { isPaidOut: true },
          );
          this.logger.log(
            `Marked ${payout.orderIds.length} orders as paid for payout ${reference}`,
          );
        }
      }
      if (
        (status === PayoutStatus.FAILED || status === PayoutStatus.REVERSED) &&
        payout.orderIds?.length
      ) {
        await manager.update(
          Orders,
          { id: In(payout.orderIds) },
          { isPaidOut: false },
        );
      }
    });
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private delay(milliseconds: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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

  async getUserPayout(userId: string) {
    const payouts = await this.payoutRepo.find({
      where: { vendor: { id: userId } },
      order: { createdAt: 'DESC' },
    });
    return new StandardResponse(
      false,
      'PAYOUTS_FETCHED',
      payouts.map((payout) => ({
        ...payout,
        vendorId: userId,
        accountNumber: this.maskAccountNumber(payout.accountNumber),
      })),
    );
  }

  async getPayoutStatus(reference: string) {
    const payout = await this.payoutRepo
      .createQueryBuilder('payout')
      .leftJoin('payout.vendor', 'vendor')
      .addSelect([
        'vendor.id',
        'vendor.firstName',
        'vendor.lastName',
        'vendor.email',
        'vendor.userRole',
      ])
      .where('payout.reference = :reference', { reference })
      .getOne();

    if (!payout) {
      return new StandardResponse(true, 'PAYOUT_NOT_FOUND', {});
    }

    return new StandardResponse(false, 'PAYOUT_STATUS_FETCHED', {
      ...payout,
      vendorId: payout.vendor?.id,
      accountNumber: this.maskAccountNumber(payout.accountNumber),
    });
  }

  async getAllPayouts(filters?: PayoutQueryFilters) {
    return this.getPayoutsByRole(UserRoles.VENDOR, filters);
  }

  async getRiderPayouts(filters?: PayoutQueryFilters) {
    return this.getPayoutsByRole(UserRoles.RIDER, filters);
  }

  private async getPayoutsByRole(
    role: UserRoles.VENDOR | UserRoles.RIDER,
    filters?: PayoutQueryFilters,
  ) {
    if (
      filters?.minAmount !== undefined &&
      filters?.maxAmount !== undefined &&
      filters.minAmount > filters.maxAmount
    ) {
      throw new BadRequestException('minAmount cannot exceed maxAmount');
    }
    if (
      filters?.startDate &&
      filters?.endDate &&
      this.parsePayoutDate(filters.startDate, false) >
        this.parsePayoutDate(filters.endDate, true)
    ) {
      throw new BadRequestException('startDate cannot be after endDate');
    }

    const query = this.payoutRepo
      .createQueryBuilder('payout')
      .leftJoin('payout.vendor', 'vendor')
      .addSelect([
        'vendor.id',
        'vendor.firstName',
        'vendor.lastName',
        'vendor.email',
        'vendor.userRole',
      ])
      .leftJoin('vendor.store', 'store')
      .addSelect(['store.id', 'store.name'])
      .leftJoin(Rider, 'rider', 'rider.userId = vendor.id')
      // Doctor payouts share this table (see DoctorPayoutService), so every
      // admin list must explicitly scope itself to one account type.
      .where('vendor.userRole = :role', { role });

    // Apply filters
    if (filters?.vendorId) {
      query.andWhere('vendor.id = :vendorId', { vendorId: filters.vendorId });
    }

    if (filters?.status) {
      query.andWhere('payout.status = :status', { status: filters.status });
    }

    if (filters?.startDate) {
      query.andWhere('payout.createdAt >= :startDate', {
        startDate: this.parsePayoutDate(filters.startDate, false),
      });
    }

    if (filters?.endDate) {
      query.andWhere('payout.createdAt <= :endDate', {
        endDate: this.parsePayoutDate(filters.endDate, true),
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
        `(LOWER(vendor.firstName) LIKE :search OR LOWER(vendor.lastName) LIKE :search OR LOWER(vendor.email) LIKE :search OR LOWER(store.name) LIKE :search OR LOWER(rider.id) LIKE :search OR LOWER(rider.licensePlate) LIKE :search OR LOWER(payout.reference) LIKE :search OR LOWER(payout.accountName) LIKE :search OR LOWER(payout.bankName) LIKE :search OR LOWER(payout.accountNumber) LIKE :search)`,
        { search: `%${searchLower}%` },
      );
    }

    // Handle pagination
    const page = Math.max(filters?.page || 1, 1);
    const limit = Math.min(Math.max(filters?.limit || 20, 1), 100);
    const skip = (page - 1) * limit;

    const sortColumn =
      filters?.sortBy === 'amount' ? 'payout.amount' : 'payout.createdAt';
    const sortOrder = filters?.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    query.orderBy(sortColumn, sortOrder).addOrderBy('payout.id', 'ASC');

    query.skip(skip).take(limit);

    const [data, total] = await query.getManyAndCount();
    const riderProfiles =
      role === UserRoles.RIDER && data.length
        ? await this.riderRepo.find({
            where: {
              userId: In(
                data
                  .map((payout) => payout.vendor?.id)
                  .filter((id): id is string => Boolean(id)),
              ),
            },
          })
        : [];
    const ridersByUserId = new Map(
      riderProfiles.map((rider) => [rider.userId, rider]),
    );
    const safeData = data.map((payout) => {
      const rider = payout.vendor?.id
        ? ridersByUserId.get(payout.vendor.id)
        : undefined;
      return {
        ...payout,
        vendorId: payout.vendor?.id,
        riderId: rider?.id,
        rider: rider
          ? {
              id: rider.id,
              bikeType: rider.bikeType,
              licensePlate: rider.licensePlate,
              payoutSchedule: rider.payoutSchedule,
            }
          : undefined,
        accountNumber: this.maskAccountNumber(payout.accountNumber),
      };
    });

    return new StandardResponse(false, 'PAYOUTS_FETCHED', {
      data: safeData,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  }

  async getPayoutStats() {
    return this.getPayoutStatsByRole(UserRoles.VENDOR);
  }

  async getRiderPayoutStats() {
    return this.getPayoutStatsByRole(UserRoles.RIDER);
  }

  private async getPayoutStatsByRole(role: UserRoles.VENDOR | UserRoles.RIDER) {
    const raw = await this.payoutRepo
      .createQueryBuilder('payout')
      .innerJoin('payout.vendor', 'vendor')
      .where('vendor.userRole = :role', { role })
      .select(
        `COALESCE(SUM(CASE WHEN payout.status IN (:...active) THEN payout.amount ELSE 0 END), 0)`,
        'totalPending',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN payout.status = :approved THEN payout.amount ELSE 0 END), 0)`,
        'totalCompleted',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE payout.status IN (:...active))`,
        'pendingCount',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE payout.status = :approved)`,
        'completedCount',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE payout.status = :processing)`,
        'processingCount',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE payout.status = :failed)`,
        'failedCount',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE payout.status = :reversed)`,
        'reversedCount',
      )
      .setParameters({
        active: ACTIVE_PAYOUT_STATUSES,
        approved: PayoutStatus.APPROVED,
        processing: PayoutStatus.PROCESSING,
        failed: PayoutStatus.FAILED,
        reversed: PayoutStatus.REVERSED,
      })
      .getRawOne();

    return new StandardResponse(false, 'PAYOUT_STATS_FETCHED', {
      totalPending: Number(raw?.totalPending || 0),
      totalCompleted: Number(raw?.totalCompleted || 0),
      pendingCount: Number(raw?.pendingCount || 0),
      completedCount: Number(raw?.completedCount || 0),
      processingCount: Number(raw?.processingCount || 0),
      failedCount: Number(raw?.failedCount || 0),
      reversedCount: Number(raw?.reversedCount || 0),
    });
  }

  private parsePayoutDate(value: string, endOfDay: boolean) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(
        `${value}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}+01:00`,
      );
    }
    return new Date(value);
  }

  private maskAccountNumber(accountNumber?: string) {
    if (!accountNumber) return '';
    return `******${accountNumber.slice(-4)}`;
  }

  async runRiderPayouts(options?: { isManual?: boolean; riderId?: string }) {
    this.logger.log('Running rider payouts...');

    try {
      // Rider wallets already contain the net 80% delivery earnings. Paystack
      // receives the available wallet balance unchanged so commission is never
      // applied twice.
      this.paystack.assertConfigured();
      // 1. Fetch riders who have bank details and their user/wallet info
      const query = this.riderRepo
        .createQueryBuilder('rider')
        .leftJoinAndSelect('rider.user', 'user')
        .leftJoinAndSelect('user.wallet', 'wallet');

      if (options?.riderId) {
        query.where('rider.id = :riderId', { riderId: options.riderId });
      }

      const riders = await query.getMany();

      const isSunday = new Date().getDay() === 0;
      const isFirstOfMonth = new Date().getDate() === 1;

      // Filter eligible riders
      const eligible: { rider: Rider; user: Users; balance: number }[] = [];
      for (const rider of riders) {
        if (!rider.user) continue;
        // A stale Rider row must never make a user with another platform role
        // eligible for the rider settlement path.
        if (rider.user.userRole !== UserRoles.RIDER) {
          this.logger.warn(
            `Skipping rider ${rider.id}: linked user is not a RIDER account`,
          );
          continue;
        }

        const balance = Number(rider.user.wallet?.walletBalance || 0);
        if (balance <= 0) continue;

        if (
          !rider.bankDetailsVerified ||
          !rider.bankName ||
          !rider.accountNumber ||
          !rider.bankCode
        ) {
          this.logger.log(
            `Rider ${rider.id} has a balance but no verified bank details - skipping`,
          );
          continue;
        }

        // Check schedule if not manual request
        if (!options?.isManual) {
          const schedule = rider.payoutSchedule;
          if (schedule === PayoutSchedule.WEEKLY && !isSunday) continue;
          if (schedule === PayoutSchedule.MONTHLY && !isFirstOfMonth) continue;
          if (schedule === PayoutSchedule.MANUAL) continue; // Manual schedule runs only on manual request
        }

        // Idempotency check: do not overlap a submitted or reconciling payout.
        const inFlight = await this.payoutRepo.findOne({
          where: {
            vendor: { id: rider.user.id },
            status: In(ACTIVE_PAYOUT_STATUSES),
          },
        });
        if (inFlight) {
          this.logger.warn(
            `Rider ${rider.id} already has an in-flight payout (${inFlight.reference}) - skipping`,
          );
          continue;
        }

        eligible.push({ rider, user: rider.user, balance });
      }

      if (!eligible.length) {
        this.logger.log(
          'No riders with a positive wallet balance eligible for payout.',
        );
        return new StandardResponse(false, 'NO_ELIGIBLE_PAYOUTS', { count: 0 });
      }

      // 2. Create Paystack recipients for any eligible rider missing one.
      const uniqueRecipientKeys = new Set<string>();
      const recipientsToCreate = eligible
        .filter((e) => !e.rider.recipientCode)
        .filter((e) => {
          const key = this.recipientKey(
            e.rider.accountNumber,
            e.rider.bankCode,
          );
          if (uniqueRecipientKeys.has(key)) return false;
          uniqueRecipientKeys.add(key);
          return true;
        })
        .map((e) => ({
          name:
            e.rider.accountHolderName ||
            `${e.user.firstName} ${e.user.lastName}`,
          account_number: e.rider.accountNumber,
          bank_code: e.rider.bankCode,
          currency: 'NGN',
        }));

      const recipientOwners = new Map<
        string,
        Array<(typeof eligible)[number]>
      >();
      for (const entry of eligible.filter((e) => !e.rider.recipientCode)) {
        const key = this.recipientKey(
          entry.rider.accountNumber,
          entry.rider.bankCode,
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
            `Creating ${recipientBatch.length} bulk recipients for riders...`,
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
              const riders = matches.map(({ rider }) => {
                rider.recipientCode = recipient.recipient_code;
                return rider;
              });
              await this.riderRepo.save(riders);
              recipientOwners.delete(key);
            }
          }
        } catch (error: unknown) {
          this.logger.error(
            'Rider recipient creation failed',
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      // 3. Build the transfer payload + a PENDING payout record per rider.
      const transfersPayload: Array<{
        amount: number;
        recipient: string;
        reason: string;
        reference: string;
      }> = [];
      const localTxns: PayoutTransactions[] = [];

      for (const { rider, user } of eligible) {
        if (!rider.recipientCode) {
          this.logger.warn(
            `Rider ${rider.id} still has no recipient code - skipping`,
          );
          continue;
        }

        const reference = createPayoutReference('payout');
        const txn = await this.dataSource.transaction(async (manager) => {
          const wallet = await manager.findOne(Wallets, {
            where: { userId: user.id },
            lock: { mode: 'pessimistic_write' },
          });
          const currentBalance = Number(wallet?.walletBalance || 0);
          if (currentBalance <= 0) return null;

          const inFlight = await manager.findOne(PayoutTransactions, {
            where: {
              vendor: { id: user.id },
              status: In(ACTIVE_PAYOUT_STATUSES),
            },
          });
          if (inFlight) return null;

          const amount = Number(currentBalance.toFixed(2));
          const pendingPayout = manager.create(PayoutTransactions, {
            vendor: user,
            amount,
            reference,
            status: PayoutStatus.PROCESSING,
            bankName: rider.bankName,
            accountNumber: rider.accountNumber,
            accountName:
              rider.accountHolderName || `${user.firstName} ${user.lastName}`,
            providerReference: '',
            narration: `Rider wallet settlement of NGN${amount}`,
            orderIds: null,
            fundsReserved: true,
            reconciliationAttempts: 0,
          });
          const saved = await manager.save(PayoutTransactions, pendingPayout);
          const reservation = await manager.decrement(
            Wallets,
            { id: wallet.id },
            'walletBalance',
            amount,
          );
          if (reservation.affected !== 1) {
            throw new Error(
              `Unable to reserve rider wallet funds for ${rider.id}`,
            );
          }
          return saved;
        });

        if (!txn) continue;

        const amount = Number(txn.amount);

        transfersPayload.push({
          amount: Math.round(amount * 100), // kobo
          recipient: rider.recipientCode,
          reason: txn.narration,
          reference,
        });
        localTxns.push(txn);
      }

      if (!transfersPayload.length) {
        this.logger.log(
          'No eligible rider payouts after recipient resolution.',
        );
        return new StandardResponse(false, 'NO_ELIGIBLE_PAYOUTS', { count: 0 });
      }

      // 4. Keep provider payloads bounded. Timeouts and server errors remain
      // in-flight until reconciliation proves their final outcome.
      const batches = this.chunk(transfersPayload, PAYSTACK_BATCH_SIZE);
      let acknowledged = 0;
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex];
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
                'Paystack response did not contain this rider transfer',
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
                this.updateStatus(
                  transfer.reference,
                  PayoutStatus.FAILED,
                  `http_${responseStatus}`,
                  undefined,
                  `Provider rejected rider payout: ${message}`.slice(0, 255),
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

        if (batchIndex < batches.length - 1) {
          await this.delay(PAYSTACK_BATCH_DELAY_MS);
        }
      }

      this.logger.log(
        `Created ${localTxns.length} rider payout(s); ${acknowledged} acknowledged immediately`,
      );
      return new StandardResponse(false, 'PAYOUTS_INITIATED', {
        message: `Created ${localTxns.length} rider settlement(s)`,
        count: localTxns.length,
        acknowledgedCount: acknowledged,
        totalAmount: localTxns.reduce((sum, tx) => sum + Number(tx.amount), 0),
      });
    } catch (error: any) {
      this.logger.error('Error running rider payouts:', error);
      return new StandardResponse(true, 'PAYOUT_ERROR', {
        error: error.message,
      });
    }
  }
}

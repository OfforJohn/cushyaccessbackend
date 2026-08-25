import { DataSource, In, Repository } from 'typeorm';
import { Wallets } from '../model/wallet.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { CommonService } from '../../common/common.service';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PinDto } from '../model/dto/pin.dto';
import { StandardResponse } from '../../common/module/standard-response';
import * as bcrypt from 'bcryptjs';
import { ComparePinDto } from '../model/dto/compare-pin.dto';
import { UpdatePinDto } from '../model/dto/update-pin.dto';
import { ValidatePin } from '../model/dto/validate-pin.dto';
import { UserRoles } from 'src/users/model/user-roles.enum';
import { ManualFunding } from '../model/manual-funding.entity';
import { ManualFundingDto } from '../model/dto/manual-funding.dto';
import { MailSenderService } from 'src/user-otp/mail-sender.service';
import { Users } from 'src/users/model/users.entity';
import { TransactionRequest } from '../model/dto/transaction.request';
import { TransactionCategory } from '../model/transaction-category.enum';
import { TransactionStatus } from '../model/transaction-status.enum';
import { TransactionService } from './transaction.service';
import { v4 as uuidv4 } from 'uuid';
import { BulkWalletAdjustmentDto } from '../model/dto/bulk-wallet-adjustment.dto';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallets)
    private readonly walletRepository: Repository<Wallets>,
    @InjectRepository(ManualFunding)
    private readonly manualFundingRepository: Repository<ManualFunding>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly commonService: CommonService,
    private readonly dataSource: DataSource,
    private readonly mailSenderService: MailSenderService,
    private readonly transactionService: TransactionService,
  ) {}

  async createWallet(): Promise<Wallets> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const wallet = new Wallets();
    wallet.userId = authenticatedUser.id;
    wallet.walletBalance = 0;
    wallet.hasSetPin = false;
    // A dedicated bank account remains lazily provisioned when the user opens
    // Add Money; creating an internal wallet must not allocate one.
    return await this.walletRepository.save(wallet);
  }

  async getWallet(userId: string): Promise<Wallets> {
    return await this.walletRepository.findOne({ where: { userId } });
  }

  async getOrCreateWallet(userId: string): Promise<Wallets> {
    let wallet = await this.walletRepository.findOne({ where: { userId } });
    if (!wallet) {
      wallet = new Wallets();
      wallet.userId = userId;
      wallet.walletBalance = 0;
      wallet.hasSetPin = false;
      wallet = await this.walletRepository.save(wallet);
    }
    return wallet;
  }

  async getWalletByAccountNumber(
    userId: string,
    virtualAccountNumber: string,
  ): Promise<Wallets> {
    return await this.walletRepository.findOne({
      where: {
        userId,
        virtualAccount: { accountNumber: virtualAccountNumber },
      },
    });
  }

  async isExistingWallet(userId: string): Promise<boolean> {
    return await this.walletRepository.exists({ where: { userId } });
  }

  async existingWallet(walletId: string) {
    return await this.walletRepository.findOne({
      where: { id: walletId },
      relations: ['user'],
    });
  }

  async updateWallets(wallets: Wallets[]): Promise<void> {
    await this.walletRepository.save(wallets);
  }

  async createTransactionPin(pintDto: PinDto) {
    const authenticatedUser = await this.commonService.getLoggedInUser();

    if (authenticatedUser.id !== pintDto.userId) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'UNAUTHORIZED_WALLLET_ACCESS'),
      );
    }

    const wallet = await this.walletRepository.findOne({
      where: { userId: pintDto.userId },
    });

    if (!wallet) {
      throw new NotFoundException(
        new StandardResponse(true, 'WALLET_NOT_INITIALIZED'),
      );
    }

    if (wallet.pin) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'PIN_ALREADY_SET'),
      );
    }

    wallet.pin = await this.hashPassword(pintDto.pin);
    wallet.hasSetPin = true;
    await this.walletRepository.save(wallet);

    return new StandardResponse(false, 'TRANSACTION_PIN_CREATED_SUCCESSFULLY');
  }

  async updateTransactionPin(updatePinDto: UpdatePinDto) {
    const authenticatedUser = await this.commonService.getLoggedInUser();

    if (authenticatedUser.id !== updatePinDto.userId) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'UNAUTHORIZED_WALLLET_ACCESS'),
      );
    }

    const wallet = await this.walletRepository.findOne({
      where: { userId: updatePinDto.userId },
    });

    if (!wallet) {
      throw new NotFoundException(
        new StandardResponse(true, 'WALLET_NOT_INITIALIZED'),
      );
    }

    if (!wallet.pin) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'PIN_NOT_SET'),
      );
    }

    const match = await this.isPinCorrect({
      hashedPassword: wallet.pin,
      plainPassword: updatePinDto.oldPin,
    });

    if (!match) {
      throw new BadRequestException(
        new StandardResponse(true, 'OLD_PIN_IS_INCORRECT'),
      );
    }

    wallet.pin = await this.hashPassword(updatePinDto.pin);
    wallet.hasSetPin = true;
    await this.walletRepository.save(wallet);

    return new StandardResponse(false, 'TRANSACTION_PIN_UPDATED_SUCCESSFULLY');
  }

  async validatePin(validatePinDto: ValidatePin) {
    const { pin, userId } = validatePinDto;
    const authenticatedUser = await this.commonService.getLoggedInUser();

    if (authenticatedUser.id !== userId) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'UNAUTHORIZED_WALLLET_ACCESS'),
      );
    }

    const wallet = await this.walletRepository.findOne({ where: { userId } });

    const match = await this.isPinCorrect({
      hashedPassword: wallet.pin,
      plainPassword: pin,
    });

    const message = match ? 'PIN_IS_VALID' : 'IN_VALID_PIN';
    return new StandardResponse(false, message);
  }

  async isPinCorrect(passwordsDto: ComparePinDto): Promise<boolean> {
    return await bcrypt.compare(
      passwordsDto.plainPassword,
      passwordsDto.hashedPassword,
    );
  }

  async hashPassword(password: string): Promise<string> {
    const saltOrRounds = 10;
    const hash = await bcrypt.hash(password, saltOrRounds);
    return hash;
  }

  //Manual Funding
  async createManualFunding(manualFundingDto: ManualFundingDto) {
    // Input validation
    if (manualFundingDto.amount <= 0) {
      throw new BadRequestException(
        new StandardResponse(true, 'AMOUNT_MUST_BE_GREATER_THAN_ZERO'),
      );
    }

    const authenticatedUser = await this.commonService.getLoggedInUser();

    // Generate unique reference
    const transactionReference = this.generateTransactionReference();

    let savedManualFunding: ManualFunding;

    // Use database transaction for data consistency
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Check if reference already exists (prevent duplicate)
      const existingFunding = await queryRunner.manager.findOne(ManualFunding, {
        where: { transactionReference },
      });

      if (existingFunding) {
        throw new BadRequestException(
          new StandardResponse(true, 'DUPLICATE_TRANSACTION_REFERENCE'),
        );
      }

      // Find wallet with lock to prevent race conditions
      const wallet = await queryRunner.manager.findOne(Wallets, {
        where: { userId: manualFundingDto.userId },
        lock: { mode: 'pessimistic_write' }, // Lock the row for update
      });

      if (!wallet) {
        throw new NotFoundException(
          new StandardResponse(true, 'WALLET_NOT_INITIALIZED'),
        );
      }

      // Create Manual Funding Record
      const manualFunding = new ManualFunding();
      manualFunding.walletId = wallet.id;
      manualFunding.userId = manualFundingDto.userId; // Store userId for easier querying
      manualFunding.amount = manualFundingDto.amount;
      manualFunding.fundedBy = `${authenticatedUser.firstName} ${authenticatedUser.lastName}`;
      manualFunding.fundedById = authenticatedUser.id; // Store admin ID for audit trail
      manualFunding.description =
        manualFundingDto.description || 'Manual funding';
      manualFunding.transactionReference = transactionReference;
      manualFunding.status = 'SUCCESSFUL';
      manualFunding.oldBalance = wallet.walletBalance;
      manualFunding.newBalance = wallet.walletBalance + manualFundingDto.amount;
      manualFunding.currency = 'NGN'; // Add currency support

      // Save manual funding record
      savedManualFunding = await queryRunner.manager.save(manualFunding);

      // Update Wallet Balance
      const newBalance = wallet.walletBalance + manualFundingDto.amount;
      wallet.walletBalance = newBalance;

      await queryRunner.manager.save(wallet);

      // Commit transaction
      await queryRunner.commitTransaction();

      console.log(
        `Manual funding successful: ${transactionReference} - Amount: ${manualFundingDto.amount} - User: ${manualFundingDto.userId}`,
      );
    } catch (error: any) {
      // Rollback transaction on error
      await queryRunner.rollbackTransaction();

      console.error(`Manual funding failed: ${error.message}`, error.stack);

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        new StandardResponse(true, 'MANUAL_FUNDING_FAILED', {
          reference: transactionReference,
          error:
            process.env.NODE_ENV === 'development' ? error.message : undefined,
        }),
      );
    } finally {
      // Release query runner
      await queryRunner.release();
    }
    const user = await this.usersRepository.findOne({
      where: { id: manualFundingDto.userId },
    });
    // Optional: Send notification to user
    await this.sendFundingNotification(
      user.email,
      user.firstName,
      savedManualFunding,
    );

    return new StandardResponse(
      false,
      'MANUAL_FUNDING_SUCCESSFUL',
      this.mapManualFundingResponse(savedManualFunding),
    );
  }

  //Manual Debit
  async createManualDebit(manualFundingDto: ManualFundingDto) {
    // Input validation - amount must be positive
    if (manualFundingDto.amount <= 0) {
      throw new BadRequestException(
        new StandardResponse(true, 'AMOUNT_MUST_BE_GREATER_THAN_ZERO'),
      );
    }

    const authenticatedUser = await this.commonService.getLoggedInUser();

    // Generate unique reference
    const transactionReference = this.generateDebitReference();

    let savedManualFunding: ManualFunding;

    // Use database transaction for data consistency
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Find wallet with lock to prevent race conditions
      const wallet = await queryRunner.manager.findOne(Wallets, {
        where: { userId: manualFundingDto.userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!wallet) {
        throw new NotFoundException(
          new StandardResponse(true, 'WALLET_NOT_INITIALIZED'),
        );
      }

      // Check if wallet has sufficient balance
      if (wallet.walletBalance < manualFundingDto.amount) {
        throw new BadRequestException(
          new StandardResponse(true, 'INSUFFICIENT_WALLET_BALANCE', {
            currentBalance: wallet.walletBalance,
            requestedAmount: manualFundingDto.amount,
          }),
        );
      }

      // Create Manual Debit Record (negative amount)
      const manualFunding = new ManualFunding();
      manualFunding.walletId = wallet.id;
      manualFunding.userId = manualFundingDto.userId;
      manualFunding.amount = -Math.abs(manualFundingDto.amount); // Store as negative
      manualFunding.fundedBy = `${authenticatedUser.firstName} ${authenticatedUser.lastName}`;
      manualFunding.fundedById = authenticatedUser.id;
      manualFunding.description =
        manualFundingDto.description || 'Manual debit';
      manualFunding.transactionReference = transactionReference;
      manualFunding.status = 'SUCCESSFUL';
      manualFunding.oldBalance = wallet.walletBalance;
      manualFunding.newBalance = wallet.walletBalance - manualFundingDto.amount;
      manualFunding.currency = 'NGN';

      // Save manual debit record
      savedManualFunding = await queryRunner.manager.save(manualFunding);

      // Update Wallet Balance (deduct)
      wallet.walletBalance = wallet.walletBalance - manualFundingDto.amount;

      await queryRunner.manager.save(wallet);

      // Commit transaction
      await queryRunner.commitTransaction();

      console.log(
        `Manual debit successful: ${transactionReference} - Amount: ${manualFundingDto.amount} - User: ${manualFundingDto.userId}`,
      );
    } catch (error: any) {
      // Rollback transaction on error
      await queryRunner.rollbackTransaction();

      console.error(`Manual debit failed: ${error.message}`, error.stack);

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        new StandardResponse(true, 'MANUAL_DEBIT_FAILED', {
          reference: transactionReference,
          error:
            process.env.NODE_ENV === 'development' ? error.message : undefined,
        }),
      );
    } finally {
      // Release query runner
      await queryRunner.release();
    }

    const user = await this.usersRepository.findOne({
      where: { id: manualFundingDto.userId },
    });
    // Optional: Send notification to user
    await this.sendDebitNotification(
      user.email,
      user.firstName,
      savedManualFunding,
    );

    return new StandardResponse(
      false,
      'MANUAL_DEBIT_SUCCESSFUL',
      this.mapManualFundingResponse(savedManualFunding),
    );
  }

  async createBulkManualAdjustment(dto: BulkWalletAdjustmentDto) {
    if (!dto.description?.trim()) {
      throw new BadRequestException(
        new StandardResponse(true, 'DESCRIPTION_IS_REQUIRED'),
      );
    }
    if (dto.debitAll && dto.type !== 'debit') {
      throw new BadRequestException(
        new StandardResponse(true, 'DEBIT_ALL_ONLY_VALID_FOR_DEBITS'),
      );
    }
    const amount =
      dto.amount === undefined
        ? undefined
        : Math.round(Number(dto.amount) * 100) / 100;
    if (!dto.debitAll && (!Number.isFinite(amount) || !amount || amount <= 0)) {
      throw new BadRequestException(
        new StandardResponse(true, 'AMOUNT_MUST_BE_GREATER_THAN_ZERO'),
      );
    }

    const authenticatedUser = await this.commonService.getLoggedInUser();
    const normalizedUserIds = dto.userIds.map((id) => id.trim());
    const userIds = [...new Set(normalizedUserIds)].sort();
    if (
      userIds.length !== normalizedUserIds.length ||
      userIds.length === 0 ||
      userIds.length > 20
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'USER_IDS_MUST_BE_1_TO_20_UNIQUE_VALUES'),
      );
    }
    const batchReference = `MWB_${Date.now()}_${uuidv4().slice(0, 8)}`;
    const transactionResult = await this.dataSource.transaction(
      async (manager) => {
        const users = await manager.find(Users, {
          where: { id: In(userIds) },
        });
        if (users.length !== userIds.length) {
          const foundIds = new Set(users.map((user) => user.id));
          throw new NotFoundException(
            new StandardResponse(true, 'ONE_OR_MORE_USERS_NOT_FOUND', {
              missingUserIds: userIds.filter((id) => !foundIds.has(id)),
            }),
          );
        }
        const adjustableRoles = new Set<UserRoles>([
          UserRoles.CUSTOMER,
          UserRoles.VENDOR,
          UserRoles.DOCTOR,
          UserRoles.RIDER,
        ]);
        const ineligibleUserIds = users
          .filter((user) => !adjustableRoles.has(user.userRole))
          .map((user) => user.id);
        if (ineligibleUserIds.length > 0) {
          throw new BadRequestException(
            new StandardResponse(true, 'WALLET_ROLE_NOT_ADJUSTABLE', {
              userIds: ineligibleUserIds,
            }),
          );
        }

        const wallets = await manager
          .getRepository(Wallets)
          .createQueryBuilder('wallet')
          .setLock('pessimistic_write')
          .where('wallet.userId IN (:...userIds)', { userIds })
          .orderBy('wallet.userId', 'ASC')
          .getMany();
        if (wallets.length !== userIds.length) {
          const walletUserIds = new Set(wallets.map((wallet) => wallet.userId));
          throw new NotFoundException(
            new StandardResponse(true, 'ONE_OR_MORE_WALLETS_NOT_INITIALIZED', {
              userIds: userIds.filter((id) => !walletUserIds.has(id)),
            }),
          );
        }

        const usersById = new Map(users.map((user) => [user.id, user]));
        const records: ManualFunding[] = [];
        const results: Array<{
          userId: string;
          amount: number;
          oldBalance: number;
          newBalance: number;
          status: 'processed' | 'skipped_empty';
          transactionReference?: string;
        }> = [];

        wallets.forEach((wallet, index) => {
          const oldBalance = Number(wallet.walletBalance);
          const adjustmentAmount = dto.debitAll ? oldBalance : amount!;
          if (dto.debitAll && adjustmentAmount <= 0) {
            results.push({
              userId: wallet.userId,
              amount: 0,
              oldBalance,
              newBalance: oldBalance,
              status: 'skipped_empty',
            });
            return;
          }
          if (dto.type === 'debit' && oldBalance < adjustmentAmount) {
            throw new BadRequestException(
              new StandardResponse(true, 'INSUFFICIENT_WALLET_BALANCE', {
                userId: wallet.userId,
                currentBalance: oldBalance,
                requestedAmount: adjustmentAmount,
              }),
            );
          }

          const unroundedNewBalance =
            dto.type === 'credit'
              ? oldBalance + adjustmentAmount
              : oldBalance - adjustmentAmount;
          const newBalance = Math.round(unroundedNewBalance * 100) / 100;
          if (newBalance > 99_999_999.99) {
            throw new BadRequestException(
              new StandardResponse(true, 'WALLET_BALANCE_LIMIT_EXCEEDED', {
                userId: wallet.userId,
                currentBalance: oldBalance,
                requestedAmount: adjustmentAmount,
              }),
            );
          }

          const transactionReference = `${batchReference}_${String(index + 1).padStart(2, '0')}`;
          const record = manager.create(ManualFunding, {
            walletId: wallet.id,
            userId: wallet.userId,
            amount:
              dto.type === 'credit'
                ? adjustmentAmount
                : -Math.abs(adjustmentAmount),
            fundedBy: `${authenticatedUser.firstName} ${authenticatedUser.lastName}`,
            fundedById: authenticatedUser.id,
            description: dto.description.trim(),
            transactionReference,
            status: 'SUCCESSFUL',
            oldBalance,
            newBalance,
            currency: 'NGN',
          });
          records.push(record);
          wallet.walletBalance = newBalance;
          results.push({
            userId: wallet.userId,
            amount: adjustmentAmount,
            oldBalance,
            newBalance,
            status: 'processed',
            transactionReference,
          });
        });

        if (records.length > 0) {
          await manager.save(ManualFunding, records);
          await manager.save(Wallets, wallets);
        }
        return { records, results, usersById };
      },
    );

    await Promise.allSettled(
      transactionResult.records.map((record) => {
        const user = transactionResult.usersById.get(record.userId);
        if (!user) return Promise.resolve();
        return dto.type === 'credit'
          ? this.sendFundingNotification(user.email, user.firstName, record)
          : this.sendDebitNotification(user.email, user.firstName, record);
      }),
    );

    return new StandardResponse(false, 'BULK_WALLET_ADJUSTMENT_SUCCESSFUL', {
      batchReference,
      type: dto.type,
      debitAll: Boolean(dto.debitAll),
      processedCount: transactionResult.records.length,
      skippedCount:
        transactionResult.results.length - transactionResult.records.length,
      totalAmount:
        Math.round(
          transactionResult.records.reduce(
            (sum, record) => sum + Math.abs(Number(record.amount)),
            0,
          ) * 100,
        ) / 100,
      results: transactionResult.results,
    });
  }

  private generateDebitReference(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    return `MD_${timestamp}_${random}`;
  }

  private async sendDebitNotification(
    email: string,
    recipientName: string,
    manualFunding: ManualFunding,
  ) {
    try {
      const notificationData = {
        email,
        recipientName,
        amount: Math.abs(manualFunding.amount),
        reference: manualFunding.transactionReference,
        newBalance: manualFunding.newBalance,
        description: manualFunding.description,
        debitedBy: manualFunding.fundedBy,
        timestamp: new Date(),
      };

      const content = {
        recipientName: notificationData.recipientName,
        amount: notificationData.amount,
        reason: notificationData.description,
        reference: notificationData.reference,
        newBalance: notificationData.newBalance,
        date: notificationData.timestamp,
      };

      await this.mailSenderService.sendMail({
        recipient: notificationData.email,
        subject: 'Wallet Debit Notification',
        content: content,
        template: 'wallet-debit',
      });

      console.log(`Debit notification sent to user: ${notificationData.email}`);
    } catch (error: any) {
      console.warn(`Failed to send debit notification: ${error.message}`);
      // Don't throw error - notification failure shouldn't fail the debit
    }
  }

  private generateTransactionReference(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    return `MF_${timestamp}_${random}`;
  }

  private async sendFundingNotification(
    email: string,
    reciepientName: string,
    manualFunding: ManualFunding,
  ) {
    try {
      // Implement notification logic here
      // This could be email, push notification, SMS, etc.
      const notificationData = {
        email,
        reciepientName,
        amount: manualFunding.amount,
        reference: manualFunding.transactionReference,
        newBalance: manualFunding.newBalance,
        description: manualFunding.description,
        fundedBy: manualFunding.fundedBy,
        timestamp: new Date(),
      };
      const content = {
        recipientName: notificationData.reciepientName,
        amount: notificationData.amount,
        senderName: 'ADMIN',
        reason: notificationData.description,
        reference: notificationData.reference,
        newBalance: notificationData.newBalance,
        date: notificationData.timestamp,
      };

      await this.mailSenderService.sendMail({
        recipient: notificationData.email,
        subject: 'Wallet Credit Notification',
        content: content,
        template: 'wallet-credit',
      });

      console.log(
        `Funding notification queued for user: ${notificationData.email}`,
      );
    } catch (error: any) {
      console.warn(`Failed to send funding notification: ${error.message}`);
      // Don't throw error - notification failure shouldn't fail the funding
    }
  }

  private mapManualFundingResponse(manualFunding: ManualFunding): any {
    return {
      id: manualFunding.id,
      transactionReference: manualFunding.transactionReference,
      amount: manualFunding.amount,
      oldBalance: manualFunding.oldBalance,
      newBalance: manualFunding.newBalance,
      description: manualFunding.description,
      fundedBy: manualFunding.fundedBy,
      status: manualFunding.status,
      createdAt: manualFunding.createdAt,
      currency: manualFunding.currency,
    };
  }

  async getManualFundingHistory(
    userId?: string,
    options?: {
      page?: number;
      limit?: number;
      startDate?: Date;
      endDate?: Date;
    },
  ) {
    const query = this.manualFundingRepository
      .createQueryBuilder('mf')
      .leftJoinAndSelect('mf.user', 'user');

    if (userId) {
      query.where('mf.userId = :userId', { userId });
    }

    if (options?.startDate) {
      // Set startDate to beginning of the day (00:00:00)
      const startOfDay = new Date(options.startDate);
      startOfDay.setHours(0, 0, 0, 0);
      query.andWhere('mf.createdAt >= :startDate', { startDate: startOfDay });
    }

    if (options?.endDate) {
      // Set endDate to end of the day (23:59:59.999)
      const endOfDay = new Date(options.endDate);
      endOfDay.setHours(23, 59, 59, 999);
      query.andWhere('mf.createdAt <= :endDate', { endDate: endOfDay });
    }

    query.orderBy('mf.createdAt', 'DESC');

    if (options?.page && options?.limit) {
      const skip = (options.page - 1) * options.limit;
      query.skip(skip).take(options.limit);
    }

    const [data, total] = await query.getManyAndCount();

    return new StandardResponse(false, 'MANUAL_FUNDING_HISTORY_FETCHED', {
      data,
      meta: {
        total,
        page: options?.page || 1,
        limit: options?.limit || data.length,
        totalPages: options?.limit ? Math.ceil(total / options.limit) : 1,
      },
    });
  }

  async reverseManualFunding(transactionReference: string, reason: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let reversalResult: any;

    try {
      const manualFunding = await queryRunner.manager.findOne(ManualFunding, {
        where: { transactionReference },
        relations: ['wallet'],
      });

      if (!manualFunding) {
        throw new NotFoundException(
          new StandardResponse(true, 'FUNDING_RECORD_NOT_FOUND'),
        );
      }

      if (manualFunding.status === 'REVERSED') {
        throw new BadRequestException(
          new StandardResponse(true, 'FUNDING_ALREADY_REVERSED'),
        );
      }

      // Reverse the funding
      const wallet = manualFunding.wallet;
      wallet.walletBalance -= manualFunding.amount;

      // Create reversal record
      const reversal = new ManualFunding();
      reversal.walletId = wallet.id;
      reversal.userId = manualFunding.userId;
      reversal.amount = -manualFunding.amount; // Negative amount for reversal
      reversal.fundedBy = manualFunding.fundedBy;
      reversal.fundedById = manualFunding.fundedById;
      reversal.description = `Reversal: ${reason}`;
      reversal.transactionReference = `REV_${manualFunding.transactionReference}`;
      reversal.status = 'REVERSED';
      reversal.oldBalance = wallet.walletBalance + manualFunding.amount;
      reversal.newBalance = wallet.walletBalance;
      reversal.originalReference = manualFunding.transactionReference;
      reversal.reversalReason = reason;

      // Update original funding status
      manualFunding.status = 'REVERSED';
      manualFunding.reversalReference = reversal.transactionReference;

      await queryRunner.manager.save([wallet, manualFunding, reversal]);
      await queryRunner.commitTransaction();

      console.log(`Manual funding reversed: ${transactionReference}`);

      reversalResult = {
        reversal,
        manualFunding,
        wallet,
        userId: manualFunding.userId,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    // Send reversal notification email
    try {
      const user = await this.usersRepository.findOne({
        where: { id: reversalResult.userId },
      });
      if (user) {
        await this.sendReversalNotification(
          user.email,
          user.firstName,
          reversalResult.reversal,
          reason,
        );
      }
    } catch (error: any) {
      console.warn(`Failed to send reversal notification: ${error.message}`);
    }

    return new StandardResponse(false, 'FUNDING_REVERSED_SUCCESSFULLY', {
      reversalReference: reversalResult.reversal.transactionReference,
      amountReversed: reversalResult.manualFunding.amount,
      newBalance: reversalResult.wallet.walletBalance,
    });
  }

  async debitUserForConsultation(appointmentId: string, userId: string) {
    try {
      const wallet = await this.walletRepository.findOne({
        where: { userId: userId },
      });
      if (wallet) {
        wallet.walletBalance -= 4500;
        await this.walletRepository.save(wallet);
        const transaction = new TransactionRequest();
        transaction.userId = userId;
        transaction.walletId = wallet.id;
        transaction.amount = 4500;
        transaction.transactionReference = `CONSULT-${uuidv4()}`;
        transaction.description = 'CONSULTATION-DEBIT';
        transaction.category = TransactionCategory.CONSULTATION_DEBIT;
        transaction.status = TransactionStatus.COMPLETED;
        transaction.orderId = appointmentId;
        await this.transactionService.createTransaction(transaction);
        return new StandardResponse(false, 'USER_DEBITED_FOR_CONSULTATION');
      } else {
        return new StandardResponse(true, 'WALLET_NOT_FOUND');
      }
    } catch (error) {
      console.error(
        'Error occurred while debiting user for consultation:',
        error,
      );
    }
  }

  private async sendReversalNotification(
    email: string,
    recipientName: string,
    reversal: ManualFunding,
    reason: string,
  ) {
    try {
      const content = {
        recipientName: recipientName,
        amount: Math.abs(reversal.amount),
        reason: reason,
        reference: reversal.transactionReference,
        newBalance: reversal.newBalance,
        date: new Date(),
      };

      await this.mailSenderService.sendMail({
        recipient: email,
        subject: 'Wallet Reversal Notification',
        content: content,
        template: 'wallet-reversal',
      });

      console.log(`Reversal notification sent to user: ${email}`);
    } catch (error: any) {
      console.warn(`Failed to send reversal notification: ${error.message}`);
    }
  }
}

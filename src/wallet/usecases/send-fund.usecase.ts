import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CommonService } from '../../common/common.service';
import { StandardResponse } from '../../common/module/standard-response';
import { SendFundsDto } from '../model/dto/send-fund.dto';
import { TransactionDto } from '../model/dto/transaction.dto';
import { v4 as uuidv4 } from 'uuid';
import { TransactionCategory } from '../model/transaction-category.enum';
import { TransactionStatus } from '../model/transaction-status.enum';
import { MailSenderService } from 'src/user-otp/mail-sender.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from 'src/users/model/users.entity';
import { DataSource, In, Repository } from 'typeorm';
import { EventBus } from '@nestjs/cqrs';
import { PushNotificationEvent } from '../../users/events/push-notification.event';
import { NotificationCategory } from '../../users/model/notification-category';
import { UserRoles } from '../../users/model/user-roles.enum';
import { Wallets } from '../model/wallet.entity';
import { Transactions } from '../model/transaction.entity';

@Injectable()
export class SendFundsUsecase {
  private readonly logger = new Logger(SendFundsUsecase.name);

  constructor(
    private readonly commonService: CommonService,
    private readonly mailSenderService: MailSenderService,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly eventBus: EventBus,
    private readonly dataSource: DataSource,
  ) {}

  async execute(
    sendFundsDto: SendFundsDto,
    idempotencyKey?: string,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    if (
      sendFundsDto.senderId &&
      sendFundsDto.senderId !== authenticatedUser.id
    ) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'UNAUTHORIZED_WALLET_ACCESS'),
      );
    }
    if (sendFundsDto.recipientId === authenticatedUser.id) {
      throw new BadRequestException(
        new StandardResponse(true, 'CANNOT_SEND_TO_SELF'),
      );
    }

    const key = idempotencyKey?.trim();
    if (key && !/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_IDEMPOTENCY_KEY'),
      );
    }
    const transactionReference = `CATX-${key || uuidv4()}`;

    const result = await this.dataSource.transaction(
      'SERIALIZABLE',
      async (manager) => {
        if (key) {
          await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            `${authenticatedUser.id}:${key}`,
          ]);
          const existing = await manager.getRepository(Transactions).findOne({
            where: {
              userId: authenticatedUser.id,
              transactionReference,
              category: TransactionCategory.DEBIT,
            },
          });
          if (existing) return { transaction: existing, replayed: true };
        }

        const wallets = await manager
          .getRepository(Wallets)
          .createQueryBuilder('wallet')
          .setLock('pessimistic_write')
          .where('wallet.userId IN (:...userIds)', {
            userIds: [authenticatedUser.id, sendFundsDto.recipientId].sort(),
          })
          .orderBy('wallet.userId', 'ASC')
          .getMany();
        const senderWallet = wallets.find(
          (wallet) => wallet.userId === authenticatedUser.id,
        );
        const recipientWallet = wallets.find(
          (wallet) => wallet.userId === sendFundsDto.recipientId,
        );
        if (!senderWallet) {
          throw new NotFoundException(
            new StandardResponse(true, 'WALLET_NOT_INITIALIZED'),
          );
        }
        if (!recipientWallet) {
          throw new NotFoundException(
            new StandardResponse(true, 'RECIPIENT_WALLET_NOT_INITIALIZED'),
          );
        }
        if (sendFundsDto.amount > senderWallet.walletBalance) {
          throw new BadRequestException(
            new StandardResponse(true, 'INSUFFICIENT_FUNDS'),
          );
        }

        senderWallet.walletBalance -= sendFundsDto.amount;
        recipientWallet.walletBalance += sendFundsDto.amount;
        await manager.save(Wallets, [senderWallet, recipientWallet]);

        const transactionRepository = manager.getRepository(Transactions);
        const senderTransaction = transactionRepository.create({
          userId: authenticatedUser.id,
          walletId: senderWallet.id,
          senderUserId: authenticatedUser.id,
          senderWalletId: senderWallet.id,
          receipientUserId: sendFundsDto.recipientId,
          receipientWalletId: recipientWallet.id,
          amount: sendFundsDto.amount,
          transactionReference,
          description: 'SEND_FUNDS',
          category: TransactionCategory.DEBIT,
          status: TransactionStatus.COMPLETED,
        });
        const recipientTransaction = transactionRepository.create({
          userId: sendFundsDto.recipientId,
          walletId: recipientWallet.id,
          senderUserId: authenticatedUser.id,
          senderWalletId: senderWallet.id,
          receipientUserId: sendFundsDto.recipientId,
          receipientWalletId: recipientWallet.id,
          amount: sendFundsDto.amount,
          transactionReference,
          description: 'RECEIVED_FUNDS',
          category: TransactionCategory.CREDIT,
          status: TransactionStatus.COMPLETED,
        });
        const [savedSenderTransaction] = await transactionRepository.save([
          senderTransaction,
          recipientTransaction,
        ]);
        return { transaction: savedSenderTransaction, replayed: false };
      },
    );

    if (!result.replayed) {
      void this.notifyTransferParticipants(
        authenticatedUser,
        sendFundsDto.recipientId,
        sendFundsDto.amount,
        transactionReference,
      );
    }
    const transaction = result.transaction;
    return new StandardResponse(
      false,
      result.replayed ? 'TRANSACTION_ALREADY_PROCESSED' : 'TRANSACTION_SUCCESSFUL',
      new TransactionDto(
        transaction.id,
        transaction.amount,
        transaction.category,
        transaction.createdAt,
        transaction.status,
        transaction.orderId,
      ),
    );
  }

  private async notifyTransferParticipants(
    sender: Users,
    recipientId: string,
    amount: number,
    reference: string,
  ): Promise<void> {
    try {
      const recipient = await this.usersRepository.findOne({
        where: { id: recipientId },
      });
      if (!recipient) return;
      this.eventBus.publish(
        new PushNotificationEvent(
          recipient.id,
          recipient.userRole === UserRoles.VENDOR
            ? NotificationCategory.VENDOR_RECEIVE_FUND_VIA_IN_APP_TRANSFER
            : NotificationCategory.USER_RECEIVE_FUND_VIA_IN_APP_TRANSFER,
          `${sender.firstName} ${sender.lastName}`,
        ),
      );
      const content = {
        amount,
        date: new Date().toLocaleString('en-NG', {
          timeZone: 'Africa/Lagos',
        }),
        reference,
        currentYear: new Date().getFullYear(),
      };
      const messages: Promise<unknown>[] = [];
      if (recipient.email) {
        messages.push(
          this.mailSenderService.sendMail({
            recipient: recipient.email,
            subject: 'You Have Received Funds!',
            template: 'funds-received',
            content: {
              ...content,
              recipientName: `${recipient.firstName} ${recipient.lastName}`,
              senderName: `${sender.firstName} ${sender.lastName}`,
            },
          }),
        );
      }
      if (sender.email) {
        messages.push(
          this.mailSenderService.sendMail({
            recipient: sender.email,
            subject: 'Funds Sent Successfully!',
            template: 'funds-sent',
            content: {
              ...content,
              senderName: `${sender.firstName} ${sender.lastName}`,
              recipientName: `${recipient.firstName} ${recipient.lastName}`,
            },
          }),
        );
      }
      await Promise.allSettled(messages);
    } catch (error) {
      this.logger.error(
        `Transfer ${reference} completed but notifications failed`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

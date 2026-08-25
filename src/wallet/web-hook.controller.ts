import {
  Controller,
  Post,
  Req,
  Res,
  HttpException,
  HttpStatus,
  HttpCode,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { WebhookFundWalletUsecase } from './usecases/webhook-fund-wallet.usecase';
import { WebhookFundWalletDto } from './model/dto/webhook-fund-wallet.dto';
import { Public } from '../auth/service/public.decorator';
import { WebHookEvent } from './model/dto/paystack-response.dto';
import { PayoutService } from './services/payout.service';
import { PayoutStatus } from 'src/users/model/payout-status.enum';
import { DoctorPayoutService } from './services/doctor-payout.service';
dotenv.config();

@Controller('api/v1/webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webHookFundWalletUseCases: WebhookFundWalletUsecase,
    private readonly payoutService: PayoutService,
    private readonly doctorPayoutService: DoctorPayoutService,
  ) {}

  @Post('paystack')
  @Public()
  @HttpCode(200)
  async handlePaystackWebhook(@Req() req, @Res() res) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers['x-paystack-signature'];
    if (!secret) {
      throw new HttpException(
        'Webhook verification is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Validate Paystack webhook signature
    const signedPayload =
      (req as { rawBody?: Buffer }).rawBody ||
      Buffer.from(JSON.stringify(req.body));
    const hash = crypto
      .createHmac('sha512', secret)
      .update(signedPayload)
      .digest('hex');

    const expected = Buffer.from(hash);
    const received = Buffer.from(
      typeof signature === 'string' ? signature : '',
    );
    if (
      expected.length !== received.length ||
      !crypto.timingSafeEqual(expected, received)
    ) {
      throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
    }

    const event = req.body as WebHookEvent;
    this.logger.log(
      `Received Paystack event ${event.event} for ${event.data?.reference || 'unknown reference'}`,
    );
    if (event.event === 'charge.success') {
      const amount = event.data?.amount / 100; // Convert kobo to naira
      const data = event?.data;
      const reference = data?.reference;
      const accountNumber = data?.metadata?.receiver_account_number;
      const customerEmail = data?.customer.email;
      // Process the deposit and update user’s wallet balance

      const webHookFundWalletDto = new WebhookFundWalletDto();
      webHookFundWalletDto.amount = amount;
      webHookFundWalletDto.email = customerEmail;
      webHookFundWalletDto.accountNumber = accountNumber;
      webHookFundWalletDto.reference = reference;
      await this.webHookFundWalletUseCases.execute(webHookFundWalletDto, event);
      this.logger.log(`Processed wallet funding ${reference}`);
    } else if (event.event === 'transfer.success') {
      const reference = event.data.reference;
      if (!reference) {
        this.logger.warn('Ignoring transfer.success without a reference');
        return res.sendStatus(200);
      }
      if (reference.toLowerCase().startsWith('dpayout-')) {
        await this.doctorPayoutService.updateDoctorPayoutStatus(
          reference,
          PayoutStatus.APPROVED,
          event.data.status || 'success',
          event.data.transfer_code,
        );
      } else {
        await this.payoutService.updateStatus(
          reference,
          PayoutStatus.APPROVED,
          event.data.status || 'success',
          event.data.transfer_code,
        );
      }
      return res.sendStatus(200);
    } else if (event.event === 'transfer.failed') {
      const reference = event.data.reference;
      if (!reference) {
        this.logger.warn('Ignoring transfer.failed without a reference');
        return res.sendStatus(200);
      }
      if (reference.toLowerCase().startsWith('dpayout-')) {
        await this.doctorPayoutService.updateDoctorPayoutStatus(
          reference,
          PayoutStatus.FAILED,
          event.data.status || 'failed',
          event.data.transfer_code,
        );
      } else {
        await this.payoutService.updateStatus(
          reference,
          PayoutStatus.FAILED,
          event.data.status || 'failed',
          event.data.transfer_code,
        );
      }
      return res.sendStatus(200);
    } else if (event.event === 'transfer.reversed') {
      const reference = event.data.reference;
      if (!reference) {
        this.logger.warn('Ignoring transfer.reversed without a reference');
        return res.sendStatus(200);
      }
      if (reference.toLowerCase().startsWith('dpayout-')) {
        await this.doctorPayoutService.updateDoctorPayoutStatus(
          reference,
          PayoutStatus.REVERSED,
          event.data.status || 'reversed',
          event.data.transfer_code,
        );
      } else {
        await this.payoutService.updateStatus(
          reference,
          PayoutStatus.REVERSED,
          event.data.status || 'reversed',
          event.data.transfer_code,
        );
      }
      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  }
  // @Post('paystack-bulk-payout')
  // @HttpCode(200)
  // async handleBulkPayoutWebhook(@Req() req, @Res() res) {
  //   const signature = req.headers['x-paystack-signature'];
  //   const secret = process.env.PAYSTACK_SECRET_KEY;

  //   const hash = crypto
  //     .createHmac('sha512', secret)
  //     .update(JSON.stringify(req.body))
  //     .digest('hex');

  //   if (hash !== signature) {
  //     return res.status(HttpStatus.FORBIDDEN).send('Invalid signature');
  //   }

  //   const { event, data } = req.body;
  //   console.log(`Received Paystack webhook event: ${event}`);

  //   switch (event) {
  //     case 'transfer.success':
  //       await this.payoutService.updateStatus(data.reference, PayoutStatus.APPROVED);
  //       break;

  //     case 'transfer.failed':
  //       await this.payoutService.updateStatus(data.reference, PayoutStatus.FAILED);
  //       break;

  //     default:
  //       console.log(`Unhandled Paystack event: ${event}`);
  //       break;
  //   }

  //   return res.status(HttpStatus.OK).send('Webhook received');
  // }

}

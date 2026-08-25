import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import * as dotenv from 'dotenv';
import {
  PaystackCustomer,
  PaystackVirtualAccount,
} from '../model/dto/paystack-request.dto';
import { StandardResponse } from 'src/common/module/standard-response';
dotenv.config();

export interface PaystackTransferResult {
  amount: number;
  reference: string;
  recipient?: string;
  transfer_code?: string;
  status?: string;
  currency?: string;
}

export interface PaystackBulkTransferResponse {
  status: boolean;
  message: string;
  data: PaystackTransferResult[];
}

type PaystackErrorBody = {
  message?: string;
  code?: string;
};

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
  private readonly PAYSTACK_BASE_URL = 'https://api.paystack.co';

  private sanitizeProviderMessage(message: string): string {
    return message
      .replace(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        '[redacted-email]',
      )
      .replace(/\+?\d[\d\s()-]{7,}\d/g, '[redacted-number]');
  }

  private throwVirtualAccountProviderError(
    operation: 'customer-fetch' | 'customer-create' | 'dedicated-account',
    error: unknown,
  ): never {
    const providerError = error as AxiosError<PaystackErrorBody>;
    const status = providerError.response?.status;
    const providerMessage =
      providerError.response?.data?.message || providerError.message || '';
    const normalizedMessage = providerMessage.toLowerCase();
    const safeProviderMessage = this.sanitizeProviderMessage(providerMessage);
    this.logger.warn(
      `Paystack ${operation} failed status=${status ?? 'network'} code=${
        providerError.code ?? 'unknown'
      } message=${safeProviderMessage.slice(0, 300) || 'unknown'}`,
    );

    if (
      !status ||
      status === HttpStatus.TOO_MANY_REQUESTS ||
      status >= HttpStatus.INTERNAL_SERVER_ERROR
    ) {
      throw new HttpException(
        new StandardResponse(true, 'VIRTUAL_ACCOUNT_PROVIDER_UNAVAILABLE'),
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (
      status === HttpStatus.UNAUTHORIZED ||
      status === HttpStatus.FORBIDDEN ||
      normalizedMessage.includes('access denied') ||
      normalizedMessage.includes('not activated') ||
      normalizedMessage.includes('not available to your business')
    ) {
      throw new HttpException(
        new StandardResponse(true, 'VIRTUAL_ACCOUNT_FEATURE_UNAVAILABLE'),
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (normalizedMessage.includes('limit')) {
      throw new HttpException(
        new StandardResponse(true, 'VIRTUAL_ACCOUNT_PROVIDER_LIMIT_REACHED'),
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (
      operation === 'customer-create' ||
      normalizedMessage.includes('first_name') ||
      normalizedMessage.includes('last_name') ||
      normalizedMessage.includes('email') ||
      normalizedMessage.includes('phone') ||
      normalizedMessage.includes('customer validation')
    ) {
      throw new HttpException(
        new StandardResponse(true, 'VIRTUAL_ACCOUNT_PROFILE_INVALID'),
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    throw new HttpException(
      new StandardResponse(true, 'VIRTUAL_ACCOUNT_PROVISIONING_FAILED'),
      HttpStatus.BAD_GATEWAY,
    );
  }

  assertConfigured(): void {
    if (!this.PAYSTACK_SECRET) {
      throw new HttpException(
        new StandardResponse(true, 'VIRTUAL_ACCOUNT_FEATURE_UNAVAILABLE'),
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async createDedicatedAccount(
    customerCode: string,
    firstName?: string,
    lastName?: string,
    phoneNumber?: string,
  ): Promise<PaystackVirtualAccount> {
    this.assertConfigured();
    try {
      const preferredBank = this.PAYSTACK_SECRET?.startsWith('sk_test_')
        ? 'test-bank'
        : 'titan-paystack';
      const response = await axios.post(
        `${this.PAYSTACK_BASE_URL}/dedicated_account`,
        {
          customer: customerCode,
          preferred_bank: preferredBank,
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName ? { last_name: lastName } : {}),
          ...(phoneNumber ? { phone: phoneNumber } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${this.PAYSTACK_SECRET}`,
            'Content-Type': 'application/json',
          },
          timeout: 20_000,
        },
      );

      return response.data.data; // Returns the virtual account details
    } catch (error: unknown) {
      this.throwVirtualAccountProviderError('dedicated-account', error);
    }
  }

  async getCustomer(emailOrCode: string): Promise<PaystackCustomer | null> {
    this.assertConfigured();
    try {
      const response = await axios.get(
        `${this.PAYSTACK_BASE_URL}/customer/${encodeURIComponent(emailOrCode)}`,
        {
          headers: {
            Authorization: `Bearer ${this.PAYSTACK_SECRET}`,
            'Content-Type': 'application/json',
          },
          timeout: 20_000,
        },
      );
      return response.data.data;
    } catch (error: unknown) {
      if ((error as AxiosError).response?.status === HttpStatus.NOT_FOUND) {
        return null;
      }
      this.throwVirtualAccountProviderError('customer-fetch', error);
    }
  }

  async getOrCreateCustomer(
    email: string,
    firstName: string,
    lastName: string,
    phoneNumber: string,
  ): Promise<PaystackCustomer> {
    const existing = await this.getCustomer(email);
    if (existing) return existing;
    return this.createCustomer(email, firstName, lastName, phoneNumber);
  }

  async createCustomer(
    email: string,
    firstName: string,
    lastName: string,
    phoneNumber: string,
  ): Promise<PaystackCustomer> {
    this.assertConfigured();
    try {
      const response = await axios.post(
        `${this.PAYSTACK_BASE_URL}/customer`,
        {
          email,
          first_name: firstName,
          last_name: lastName,
          phone: phoneNumber,
        },
        {
          headers: {
            Authorization: `Bearer ${this.PAYSTACK_SECRET}`,
            'Content-Type': 'application/json',
          },
          timeout: 20_000,
        },
      );

      this.logger.log('Paystack customer created');
      return response.data.data; // Returns customer object (including customer_code)
    } catch (error: unknown) {
      this.throwVirtualAccountProviderError('customer-create', error);
    }
  }
  private headers() {
    this.assertConfigured();
    return {
      Authorization: `Bearer ${this.PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
    };
  }

  async createBulkTransferRecipient(
    recipients: {
      name: string;
      account_number: string;
      bank_code: string;
      currency?: string;
    }[],
  ) {
    try {
      const body = {
        batch: recipients.map((r) => ({
          type: 'nuban',
          name: r.name,
          account_number: r.account_number,
          bank_code: r.bank_code,
          currency: r.currency || 'NGN',
        })),
      };

      const { data } = await axios.post(
        `${this.PAYSTACK_BASE_URL}/transferrecipient/bulk`,
        body,
        { headers: this.headers() },
      );

      return data;
    } catch (error: any) {
      this.logger.warn(
        `Paystack bulk recipient request failed with status ${error?.response?.status || 'unknown'}`,
      );
      throw new HttpException('Failed to create bulk recipients', 400);
    }
  }

  async initiateBulkTransfer(
    transfers: Array<{
      amount: number;
      recipient: string;
      reason: string;
      reference: string;
    }>,
  ): Promise<PaystackBulkTransferResponse> {
    const body = {
      source: 'balance',
      currency: 'NGN',
      transfers,
    };

    const { data } = await axios.post(
      `${this.PAYSTACK_BASE_URL}/transfer/bulk`,
      body,
      { headers: this.headers(), timeout: 30_000 },
    );
    return data;
  }

  async getTransfer(id: string) {
    const { data } = await axios.get(
      `${this.PAYSTACK_BASE_URL}/transfer/${id}`,
      { headers: this.headers() },
    );
    return data;
  }

  async verifyTransfer(reference: string) {
    const { data } = await axios.get(
      `${this.PAYSTACK_BASE_URL}/transfer/verify/${encodeURIComponent(reference)}`,
      { headers: this.headers(), timeout: 15_000 },
    );
    return data;
  }
  async getAllBanks() {
    const url = `${this.PAYSTACK_BASE_URL}/bank?currency=NGN`;
    const { data } = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    return new StandardResponse(false, 'Banks fetched successfully', data.data);
  }

  async nameEnquiry(accountNumber: string, bankCode: string) {
    try {
      const account = await this.resolveBankAccount(accountNumber, bankCode);
      return new StandardResponse(
        false,
        'Account name fetched successfully',
        account,
      );
    } catch (error: any) {
      this.logger.warn(
        `Paystack name enquiry failed with status ${error?.response?.status || 'unknown'}`,
      );
      throw new StandardResponse(true, 'Error fetching account name', null);
    }
  }

  async resolveBankAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<{ account_name: string; account_number: string }> {
    const url = `${this.PAYSTACK_BASE_URL}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`;
    const { data } = await axios.get(url, { headers: this.headers() });
    return data.data;
  }
}

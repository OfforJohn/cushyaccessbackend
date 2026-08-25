import { Repository } from 'typeorm';
import { VirtualAccounts } from '../model/virtual-account.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateVirtualAccountDto } from '../model/dto/create-virtual-account.dto';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { StandardResponse } from 'src/common/module/standard-response';
import { PaystackService } from './paystack.service';
import { isEmail } from 'class-validator';
import {
  normalizePersonName,
  PERSON_NAME_PATTERN,
} from 'src/users/model/user-input-validation';
import { normalizeStoredPhone } from 'src/users/services/user-identifier';

@Injectable()
export class VirtualAccountsService {
  constructor(
    @InjectRepository(VirtualAccounts)
    private readonly virtualAccountRepository: Repository<VirtualAccounts>,
    private readonly paystackService: PaystackService,
  ) {}

  async createVirtualAccount(
    createVirtualAccountDto: CreateVirtualAccountDto,
  ): Promise<VirtualAccounts> {
    return this.virtualAccountRepository.manager.transaction(
      async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `virtual-account:${createVirtualAccountDto.walletId}`,
        ]);
        const existing = await manager.findOne(VirtualAccounts, {
          where: { walletId: createVirtualAccountDto.walletId },
        });
        if (existing) return existing;
        const virtualAccount = await this.buildVirtualAccount(
          createVirtualAccountDto,
        );
        return manager.save(VirtualAccounts, virtualAccount);
      },
    );
  }

  private async buildVirtualAccount(
    createVirtualAccountDto: CreateVirtualAccountDto,
  ): Promise<VirtualAccounts> {
    const {
      userId,
      walletId,
      email,
      mobile,
      callingCode,
      firstName,
      lastName,
    } = createVirtualAccountDto;
    if (
      !userId ||
      !walletId ||
      !email ||
      !mobile ||
      !callingCode ||
      !firstName ||
      !lastName
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'VIRTUAL_ACCOUNT_CREDENTIALS_NOT_COMPLETED'),
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedFirstName = normalizePersonName(firstName);
    const normalizedLastName = normalizePersonName(lastName);
    const normalizedCallingCode = callingCode.replace(/\D/g, '');
    const normalizedLocalPhone = normalizeStoredPhone(mobile, callingCode);
    if (
      !isEmail(normalizedEmail) ||
      !PERSON_NAME_PATTERN.test(normalizedFirstName) ||
      !PERSON_NAME_PATTERN.test(normalizedLastName) ||
      !normalizedCallingCode ||
      !normalizedLocalPhone
    ) {
      throw new UnprocessableEntityException(
        new StandardResponse(true, 'VIRTUAL_ACCOUNT_PROFILE_INVALID'),
      );
    }
    const internationalPhone = `+${normalizedCallingCode}${normalizedLocalPhone}`;

    const customer = await this.paystackService.getOrCreateCustomer(
      normalizedEmail,
      normalizedFirstName,
      normalizedLastName,
      internationalPhone,
    );

    // Recover a provider-side account after a previous request succeeded at
    // Paystack but failed before the local transaction committed.
    const paystackVirtualAccount =
      customer.dedicated_account ??
      (await this.paystackService.createDedicatedAccount(
        customer.customer_code,
        normalizedFirstName,
        normalizedLastName,
        internationalPhone,
      ));

    if (
      !paystackVirtualAccount?.account_name ||
      !paystackVirtualAccount?.account_number ||
      !paystackVirtualAccount?.bank?.name
    ) {
      throw new BadGatewayException(
        new StandardResponse(true, 'VIRTUAL_ACCOUNT_PROVIDER_RESPONSE_INVALID'),
      );
    }

    const virtualAccount = new VirtualAccounts();
    virtualAccount.userId = userId;
    virtualAccount.walletId = walletId;
    virtualAccount.accountName = paystackVirtualAccount?.account_name;
    virtualAccount.accountNumber = paystackVirtualAccount?.account_number;
    virtualAccount.bank = paystackVirtualAccount?.bank?.name;
    virtualAccount.mataData = paystackVirtualAccount;

    return virtualAccount;
  }

  async getVirtualAccount(walletId: string): Promise<VirtualAccounts> {
    return await this.virtualAccountRepository.findOne({
      where: { walletId: walletId },
      relations: ['user', 'wallet'],
    });
  }
}

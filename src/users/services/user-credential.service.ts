import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserCredentials } from '../model/user-credentials.entity';
import { UserCredentialStatus } from '../model/user-credential.enum';
import { StandardResponse } from 'src/common/module/standard-response';
import { CreateCredentialDTO } from '../model/dto/create-credential.dto';
import { CommonService } from '../../common/common.service';
import { StoreCategory } from '../../stores/model/enums/store.category';
import { UserMapper } from './user-mapper.service';
import { UsersService } from './users.service';
import { EventBus } from '@nestjs/cqrs';
import { PushNotificationEvent } from '../events/push-notification.event';
import { NotificationCategory } from '../model/notification-category';

@Injectable()
export class UserCredentialsService {
  constructor(
    @InjectRepository(UserCredentials)
    private readonly credentialsRepo: Repository<UserCredentials>,
    private readonly commonService: CommonService,
    private readonly userService: UsersService,
    private readonly eventBus: EventBus,
  ) {}

  async create(
    dto: CreateCredentialDTO,
  ): Promise<StandardResponse> {
    const user = await this.commonService.getLoggedInUser();
    const existing = await this.credentialsRepo.findOne({
      where: { userId: user.id },
    });
    if (existing) {
      throw new BadRequestException(
        new StandardResponse(true, 'CREDENTIALS_ALREADY_EXIST'),
      );
    }

    if (
      dto.vendorCategory == StoreCategory.MED_TECH &&
      !dto.pharmacyLicenseURL
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'PHARMACY_LICENSE_REQUIRED_FOR_MED_TECH'),
      );
    }

    const credentials = this.credentialsRepo.create({
      ...dto,
      userId: user.id,
      status: UserCredentialStatus.PENDING,
    });
    await this.credentialsRepo.save(credentials);
    return new StandardResponse(false, 'CREDENTIALS_CREATED', credentials);
  }

  async update(dto: Partial<CreateCredentialDTO>): Promise<StandardResponse> {
    const user = await this.commonService.getLoggedInUser();
    const userId = user.id;
    const credentials = await this.credentialsRepo.findOne({
      where: { userId: userId },
    });
    if (!credentials) {
      throw new NotFoundException(
        new StandardResponse(true, 'CREDENTIALS_NOT_FOUND'),
      );
    }
    if (credentials.status === UserCredentialStatus.APPROVED) {
      throw new BadRequestException(
        new StandardResponse(true, 'CANNOT_UPDATE_APPROVED_CREDENTIALS'),
      );
    }
    credentials.status = UserCredentialStatus.PENDING; // Reset status to PENDING on update
    Object.assign(credentials, dto);
    await this.credentialsRepo.save(credentials);
    return new StandardResponse(false, 'CREDENTIALS_UPDATED', credentials);
  }

  async updateStatus(status: UserCredentialStatus): Promise<StandardResponse> {
    const user = await this.commonService.getLoggedInUser();
    const userId = user.id;
    const credentials = await this.credentialsRepo.findOne({
      where: { userId: userId },
    });
    if (!credentials) {
      throw new NotFoundException(
        new StandardResponse(true, 'CREDENTIALS_NOT_FOUND'),
      );
    }
    credentials.status = status;
    await this.credentialsRepo.save(credentials);
    if (status === UserCredentialStatus.APPROVED) {
      // Notify user about approval
      const userDetails = await this.userService.findById(userId);
      userDetails.isVerified = true;
      await this.userService.updateUser(userDetails);
      this.eventBus.publish(
        new PushNotificationEvent(
          userId,
          NotificationCategory.VENDOR_CREDENTIAL_APPROVED,
        ),
      );
    } else if (status === UserCredentialStatus.REJECTED) {
      this.eventBus.publish(
        new PushNotificationEvent(
          userId,
          NotificationCategory.VENDOR_CREDENTIAL_REJECTED,
        ),
      );
    }
    return new StandardResponse(false, `CREDENTIALS_${status}_UPDATED`);
  }

  // Stub for third-party validation
  async validateCredentials(userId: string): Promise<StandardResponse> {
    const credentials = await this.credentialsRepo.findOne({
      where: { userId: userId },
    });
    if (!credentials) {
      throw new NotFoundException(
        new StandardResponse(true, 'CREDENTIALS_NOT_FOUND'),
      );
    }
    // TODO: Integrate with actual third-party APIs
    return new StandardResponse(false, 'VALIDATION_SUCCESS', {
      ninValid: true,
      bvnValid: true,
    });
  }
  async getUserCredentials(): Promise<StandardResponse> {
    const user = await this.commonService.getLoggedInUser();
    const userId = user.id;
    const credentials = await this.credentialsRepo.findOne({
      where: { userId: userId },
    });
    if (!credentials) {
      throw new NotFoundException(
        new StandardResponse(true, 'CREDENTIALS_NOT_FOUND'),
      );
    }
    const credentialDto = UserMapper.mapCrendentialsToDTO(credentials);
    return new StandardResponse(false, 'CREDENTIALS_FOUND', credentialDto);
  }
}

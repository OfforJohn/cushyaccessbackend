import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventBus } from '@nestjs/cqrs';

import { Rider, RiderStatus } from '../model/rider.entity';
import { RiderDocument } from '../model/rider-document.entity';
import {
  RegisterBikeRiderDto,
  RiderRegistrationResponseDto,
} from '../dto/register-rider-bike.dto';
import { UsersService } from '../../users/services/users.service';
import { WalletService } from '../../wallet/services/wallet.service';
import { CommonService } from '../../common/common.service';
import { StandardResponse } from '../../common/module/standard-response';
import { UserRoles } from '../../users/model/user-roles.enum';
import { S3Service } from '../../utils/s3-bucket.service';
import { MobileSenderService } from '../../user-otp/mobile-sender.service';
import { PushNotificationEvent } from 'src/users/events/push-notification.event';
import { NotificationCategory } from 'src/users/model/notification-category';

@Injectable()
export class RegisterBikeRiderUseCase {
  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,

    @InjectRepository(RiderDocument)
    private readonly documentRepository: Repository<RiderDocument>,

    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly commonService: CommonService,
    private readonly s3Service: S3Service,
    private readonly mobileSenderService: MobileSenderService,
    private readonly dataSource: DataSource,
    private readonly eventBus: EventBus,
  ) {}

  async execute(
    registerRiderDto: RegisterBikeRiderDto,
  ): Promise<StandardResponse> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Check if user exists
      const existingUser = await this.usersService.findByEmailOrMobile(
        registerRiderDto.personalInfo.email,
      );

      if (existingUser) {
        throw new ConflictException(
          new StandardResponse(true, 'USER_ALREADY_EXISTS'),
        );
      }

      // 3. Create user account with temporary password
      const temporaryPassword = '123456';
      const registerUserDto = {
        firstName: registerRiderDto.personalInfo.firstName,
        lastName: registerRiderDto.personalInfo.lastName,
        username: registerRiderDto.personalInfo.username,
        email: registerRiderDto.personalInfo.email,
        mobile: registerRiderDto.personalInfo.phoneNumber,
        countryCode: registerRiderDto.personalInfo.countryCode,
        callingCode: registerRiderDto.personalInfo.callingCode,
        password: temporaryPassword,
      };

      const newUser = await this.usersService.registerUser(
        registerUserDto,
        UserRoles.RIDER,
      );

      // 4. Initialize wallet
      await this.walletService.getWallet(newUser.id);

      // 5. Create rider profile
      const rider = new Rider();
      rider.userId = newUser.id;
      rider.status = RiderStatus.ACTIVE;

      // Bike info
      rider.bikeType = registerRiderDto.bikeInfo.bikeType;
      rider.bikeBrand = registerRiderDto.bikeInfo.bikeBrand;
      rider.bikeModel = registerRiderDto.bikeInfo.bikeModel;
      rider.bikeColor = registerRiderDto.bikeInfo.bikeColor;
      rider.bikeYear = registerRiderDto.bikeInfo.bikeYear;
      rider.licensePlate = registerRiderDto.bikeInfo.licensePlate;
      rider.engineDisplacement = registerRiderDto.bikeInfo.engineDisplacement;
      rider.hasHelmet = registerRiderDto.bikeInfo.hasHelmet;
      rider.hasPhoneMount = registerRiderDto.bikeInfo.hasPhoneMount;
      rider.hasDeliveryBag = registerRiderDto.bikeInfo.hasDeliveryBag;

      // License info
      rider.licenseNumber = registerRiderDto.licenseInfo.licenseNumber;
      rider.licenseClass = registerRiderDto.licenseInfo.licenseClass;
      rider.licenseExpiryDate = new Date(
        registerRiderDto.licenseInfo.licenseExpiryDate,
      );
      rider.licenseIssuingAuthority =
        registerRiderDto.licenseInfo.issuingAuthority;

      // Emergency contact
      rider.emergencyContactName = registerRiderDto.emergencyContact.fullName;
      rider.emergencyContactPhone =
        registerRiderDto.emergencyContact.phoneNumber;
      rider.emergencyContactRelation =
        registerRiderDto.emergencyContact.relationship;

      // Bank details
      rider.accountHolderName = registerRiderDto.bankDetails.accountHolderName;
      rider.bankName = registerRiderDto.bankDetails.bankName;
      rider.accountNumber = registerRiderDto.bankDetails.accountNumber;
      rider.bankCode = registerRiderDto.bankDetails.bankCode;

      // Profile photo
      rider.profilePhoto = registerRiderDto.profilePhoto;

      // Other fields
      rider.backgroundCheckStatus = 'pending';
      rider.trainingCompleted = false;

      const savedRider = await queryRunner.manager.save(Rider, rider);

      // Commit transaction
      await queryRunner.commitTransaction();

      // 7. Send welcome SMS with temporary password
      await this.mobileSenderService.sendWelcomeSms(
        registerRiderDto.personalInfo.phoneNumber,
        registerRiderDto.personalInfo.firstName,
        temporaryPassword,
        registerRiderDto.personalInfo.callingCode,
      );

      // 8. Publish registration event
      this.eventBus.publish(
        new PushNotificationEvent(
          savedRider.userId,
          NotificationCategory.RIDER_BIKE_REGISTERED,
          `You have successfully registered your bike. You can now start your training.`,
        ),
      );

      // 9. Prepare response with next steps
      const response: RiderRegistrationResponseDto = {
        riderId: savedRider.id,
        status: RiderStatus.ACTIVE,
        message: 'Rider registration submitted successfully',
      };

      return new StandardResponse(
        false,
        'RIDER_REGISTERED_SUCCESSFULLY',
        response,
      );
    } catch (error: any) {
      await queryRunner.rollbackTransaction();

      if (error instanceof ConflictException) {
        throw error;
      }

      throw new BadRequestException(
        new StandardResponse(true, 'REGISTRATION_FAILED', error.message),
      );
    } finally {
      await queryRunner.release();
    }
  }
}

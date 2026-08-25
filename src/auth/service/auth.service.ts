import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from 'src/users/services/users.service';
import * as bcrypt from 'bcryptjs';
import { JwtPayload } from '../jwt-payload.interface';
import { JwtService } from '@nestjs/jwt';
import { RegisterUserDto } from 'src/users/model/dto/regsiter-user.dto';
import { StandardResponse } from 'src/common/module/standard-response';
import { AuthRequestDto } from '../dto/auth-request.dto';
import { OnboardingService } from 'src/onboarding/onboarding.service';
import { UserOtpService } from 'src/user-otp/user-otp.service';
import { OtpType } from 'src/user-otp/model/otp-type.enum';
import { OtpRequestDto } from '../dto/otp-request.dto';
import { OnboardingType } from 'src/onboarding/model/stage.enum';
import { Users } from 'src/users/model/users.entity';
import { UserMapper } from 'src/users/services/user-mapper.service';
import { UserRoles } from '../../users/model/user-roles.enum';
import { CommonService } from '../../common/common.service';
import { PasswordRequestDto } from '../dto/password-request.dto';
import { PasswordResetRequest } from '../dto/password-reset-request.dto';
import { VerifyPasswordOtpDto } from '../dto/verify-password-otp.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { RegisterThirdPartyDto } from '../../users/model/dto/regsiter-third-party.dto';
import { EventBus } from '@nestjs/cqrs';
import { ThirdPartyRegistrationEvent } from '../../users/events/third-party-registration.event';
import { ApiKeyService } from '../../api-keys/api-key.service';
import { ApiKeyRequest } from '../dto/api-key-request.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Repository } from 'typeorm';
import { RedisCacheService } from 'src/redis-cache/redis-cache.service';
import { UserOtp } from 'src/user-otp/model/user-otp.entity';
import { OtpPurpose } from 'src/user-otp/model/otp-purpose.enum';
import { UserLocations } from 'src/users/model/user-locations.entity';
import { Wallets } from 'src/wallet/model/wallet.entity';
import { Stores } from 'src/stores/model/stores.entity';
import { ProfessionDetails } from 'src/doctor/models/professional-details.entity';
import { CreateProfessionDetailsDto } from '../dto/profession-details.dto';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { RegisterRiderDto } from 'src/users/model/register-rider.dto';
import { Rider, RiderStatus } from 'src/riders/model/rider.entity';
import { DeletePlatformAccountUseCase } from 'src/admin/usecases/delete-platform-account.usecase';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(UserLocations)
    private readonly userLocationsRepository: Repository<UserLocations>,
    @InjectRepository(Wallets)
    private readonly walletRepository: Repository<Wallets>,
    @InjectRepository(Stores)
    private readonly storeRepository: Repository<Stores>,
    @InjectRepository(ProfessionDetails)
    private readonly professionDetailsRepository: Repository<ProfessionDetails>,
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    private readonly userService: UsersService,
    private readonly jwtService: JwtService,
    private readonly onboardingService: OnboardingService,
    private readonly userOtpService: UserOtpService,
    private readonly commonService: CommonService,
    private readonly eventBus: EventBus,
    private readonly apiKeysService: ApiKeyService,
    private readonly redisCacheService: RedisCacheService,
    private readonly analyticsService: AnalyticsService,
    private readonly deletePlatformAccountUseCase: DeletePlatformAccountUseCase,
  ) {}

  async register(
    registerUserDTO: RegisterUserDto,
    role: string,
    professionalDetails?: CreateProfessionDetailsDto,
    riderDetails?: RegisterRiderDto,
  ) {
    // Validate role
    const validRoles = ['vendor', 'customer', 'doctor', 'rider'];
    if (!validRoles.includes(role)) {
      throw new BadRequestException(new StandardResponse(true, 'INVALID_ROLE'));
    }

    let userRole: UserRoles;

    switch (role) {
      case 'vendor':
        userRole = UserRoles.VENDOR;
        break;
      case 'customer':
        userRole = UserRoles.CUSTOMER;
        break;
      case 'doctor':
        userRole = UserRoles.DOCTOR;
        break;
      case 'rider':
        userRole = UserRoles.RIDER;
        break;
      default:
        throw new BadRequestException(
          new StandardResponse(true, 'INVALID_ROLE'),
        );
    }

    // ============================================
    // DOCTOR REGISTRATION
    // ============================================
    if (role === 'doctor') {
      if (
        !professionalDetails ||
        !professionalDetails.medicalLicenseNumber ||
        !professionalDetails.specialty ||
        !professionalDetails.highestQualification ||
        !professionalDetails.medicalInstitution ||
        !professionalDetails.languageSpoken ||
        !professionalDetails.medicalLicense ||
        !professionalDetails.governmentId
      ) {
        throw new BadRequestException(
          new StandardResponse(true, 'PROFESSIONAL_DETAILS_REQUIRED'),
        );
      }
      return await this.usersRepository.manager.transaction(async (manager) => {
        const user = await this.userService.registerUser(
          registerUserDTO,
          userRole,
          undefined,
          manager,
        );

        if (professionalDetails) {
          const profession = this.professionDetailsRepository.create({
            userId: user.id,
            medicalLicenseNumber:
              professionalDetails.medicalLicenseNumber || '',
            specialty: professionalDetails.specialty || '',
            highestQualification:
              professionalDetails.highestQualification || '',
            yearOfExperience: professionalDetails.yearOfExperience || 0,
            medicalInstitution: professionalDetails.medicalInstitution || '',
            languageSpoken: professionalDetails.languageSpoken || '',
            professionalBio: professionalDetails.professionalBio,
            medicalLicense: professionalDetails.medicalLicense || '',
            governmentId: professionalDetails.governmentId || '',
            professionalCertificate:
              professionalDetails.professionalCertificate || null,
          });
          await manager.save(profession);
        }

        const userDto = new UserMapper().mapUserToDto(user);
        const auth = this.generateJwt(user);

        return new StandardResponse(false, 'REGISTERED_SUCCESSFULLY', {
          user: userDto,
          specialty: professionalDetails.specialty || null,
          access_token: auth.access_token,
        });
      });
    }

    // ============================================
    // RIDER REGISTRATION
    // ============================================
    if (role === 'rider') {
      if (!riderDetails) {
        throw new BadRequestException(
          new StandardResponse(true, 'RIDER_DETAILS_REQUIRED'),
        );
      }

      return await this.usersRepository.manager.transaction(async (manager) => {
        // 1. Create User
        const user = await this.userService.registerUser(
          registerUserDTO,
          userRole,
          undefined,
          manager,
        );

        // 2. Create Rider with all fields set to null/defaults
        const rider = this.riderRepository.create({
          userId: user.id,
          // All fields explicitly set to null or defaults
          status: RiderStatus.PENDING,

          // Bike details - all null
          bikeType: null,
          bikeBrand: null,
          bikeModel: null,
          bikeColor: null,
          bikeYear: null,
          licensePlate: null,
          engineDisplacement: null,

          // Safety equipment - defaults to false
          hasHelmet: false,
          hasPhoneMount: false,
          hasDeliveryBag: false,
          deliveryBagPhoto: null,

          // License information - all null
          licenseNumber: null,
          licenseClass: null,
          licenseExpiryDate: null,
          licenseIssuingAuthority: null,

          // Profile/Verification - all null/false
          profilePhoto: null,
          idCardNumber: null,
          backgroundCheckStatus: 'pending',
          trainingCompleted: false,

          // Insurance - all null
          insuranceProvider: null,
          insurancePolicyNumber: null,
          insuranceExpiryDate: null,

          // Bank details - all null
          bankName: null,
          accountNumber: null,
          accountHolderName: null,
          bankCode: null,
          bankDetailsVerified: false,

          // Emergency contact - all null
          emergencyContactName: null,
          emergencyContactPhone: null,
          emergencyContactRelation: null,

          // Location - all null
          currentLatitude: null,
          currentLongitude: null,
          currentLocation: null,
          lastLocationUpdate: null,

          // Status defaults
          isOnline: false,
          rating: 0,
          totalDeliveries: 0,
          totalEarnings: 0,
          acceptanceRate: 0,
          completionRate: 0,
          onlineHours: 0,

          // Metadata
          metadata: null,

          // Audit fields
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await manager.save(rider);

        // 3. Create Wallet for rider
        const wallet = this.walletRepository.create({
          userId: user.id,
          walletBalance: 0,
          hasSetPin: false,
          createdAt: new Date(),
        });
        await manager.save(wallet);

        const userDto = new UserMapper().mapUserToDto(user);
        const auth = this.generateJwt(user);

        return new StandardResponse(false, 'REGISTERED_SUCCESSFULLY', {
          user: userDto,
          riderDetails: {
            id: rider.id,
            status: rider.status,
            isOnline: rider.isOnline,
            rating: rider.rating,
            totalDeliveries: rider.totalDeliveries,
            totalEarnings: rider.totalEarnings,
            // Return minimal info since most fields are null
            profileCompletion: 0, // 0% since no additional fields filled
            requiresVerification: true,
          },
          riderId: rider.id,
          access_token: auth.access_token,
        });
      });
    }

    // ============================================
    // VENDOR / CUSTOMER REGISTRATION
    // ============================================
    const user = await this.userService.registerUser(registerUserDTO, userRole);

    // Create wallet for customers
    if (userRole === UserRoles.CUSTOMER) {
      const wallet = this.walletRepository.create({
        userId: user.id,
        walletBalance: 0,
        hasSetPin: false,
        createdAt: new Date(),
      });
      await this.walletRepository.save(wallet);
    }

    const userDto = new UserMapper().mapUserToDto(user);
    const auth = this.generateJwt(user);

    return new StandardResponse(false, 'REGISTERED_SUCCESSFULLY', {
      user: userDto,
      access_token: auth.access_token,
    });
  }

  async registerThirdParty(registerThirdParty: RegisterThirdPartyDto) {
    const user = await this.userService.registerUser(
      registerThirdParty,
      UserRoles.THIRD_PARTY,
      registerThirdParty.businessName,
    );
    const userDto = new UserMapper().mapUserToDto(user);
    this.eventBus.publish(
      new ThirdPartyRegistrationEvent(userDto.id, registerThirdParty.cacURL),
    );
    return new StandardResponse(false, 'REGISTERED_SUCCESSFULLY', {
      user: userDto,
    });
  }

  async loginThirdParty(apiKeyRequest: ApiKeyRequest) {
    const { email, password } = apiKeyRequest;
    const user = await this.userService.findByEmailOrMobileWithRelation(email);
    const { userDto, auth } = await this.validatePassword(user, password);
    const apiKey = await this.apiKeysService.signIn(user);

    return new StandardResponse(false, 'AUTHENTICATED_SUCCESSFULLY', {
      user: userDto,
      access_token: auth.access_token,
      apiKey,
    });
  }

  async login(authRequest: AuthRequestDto) {
    // Keep the legacy consumer endpoint safe for older mobile builds too.
    // Rider accounts must only authenticate through the rider-app endpoint.
    return this.loginForAllowedRoles(authRequest, [
      UserRoles.CUSTOMER,
      UserRoles.VENDOR,
      UserRoles.DOCTOR,
    ]);
  }

  async loginMobileApp(authRequest: AuthRequestDto) {
    return this.loginForAllowedRoles(authRequest, [
      UserRoles.CUSTOMER,
      UserRoles.VENDOR,
      UserRoles.DOCTOR,
    ]);
  }

  async loginRiderApp(authRequest: AuthRequestDto) {
    return this.loginForAllowedRoles(authRequest, [UserRoles.RIDER], true);
  }

  private async loginForAllowedRoles(
    authRequest: AuthRequestDto,
    allowedRoles?: UserRoles[],
    resetRiderAvailability = false,
  ) {
    const { emailOrMobile, password } = authRequest;
    const user =
      await this.userService.findByEmailOrMobileWithRelation(emailOrMobile);
    const { userDto, auth } = await this.validatePassword(user, password);
    if (allowedRoles && !allowedRoles.includes(userDto.userRole as UserRoles)) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'ACCOUNT_NOT_AVAILABLE_IN_THIS_APP'),
      );
    }
    const userStores = await this.storeRepository.find({
      where: { userId: user.id },
    });
    const rider = await this.riderRepository.findOne({
      where: { userId: user.id },
    });
    // Availability belongs to the active device session, not permanently to
    // the rider account. An explicit sign-in must start offline so a second
    // device cannot inherit GPS eligibility from a previous device.
    if (resetRiderAvailability && rider) {
      await this.riderRepository.update(
        { id: rider.id, userId: user.id },
        { isOnline: false, lastLocationUpdate: null },
      );
      rider.isOnline = false;
      rider.lastLocationUpdate = null;
    }
    this.analyticsService.trackUserActivity(user.id, 'login').catch((error) => {
      console.error('Failed to track login activity:', error);
    });

    return new StandardResponse(false, 'AUTHENTICATED_SUCCESSFULLY', {
      user: userDto,
      specialty:
        userDto.userRole === UserRoles.DOCTOR
          ? user.professionDetails?.specialty
          : null,
      consultationFee:
        userDto.userRole === UserRoles.DOCTOR
          ? user.professionDetails?.consultationFee
          : null,
      hasMultipleStores: userStores.length > 1,
      access_token: auth.access_token,
      riderId: rider?.id || null,
      riderDetails: rider
        ? {
            id: rider.id,
            status: rider.status,
            isOnline: rider.isOnline,
            rating: rider.rating,
            totalDeliveries: rider.totalDeliveries,
            totalEarnings: rider.totalEarnings,
            profileCompletion: 0,
            requiresVerification: rider.status !== RiderStatus.ACTIVE,
          }
        : null,
    });
  }

  private async validatePassword(user: Users, password: string) {
    if (!user) {
      throw new NotFoundException(new StandardResponse(true, 'USER_NOT_FOUND'));
    }
    const match = await bcrypt.compare(password, user?.password);
    if (!match) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'INCORRECT_PASSWORD'),
      );
    }
    const userDto = new UserMapper().mapUserToDto(user);
    const auth = this.generateJwt(user);
    return { userDto, auth };
  }

  async sendVerificationOTP(otpRequestDto: OtpRequestDto) {
    const user = await this.commonService.getLoggedInUser();
    const otpType = otpRequestDto.otpType;
    const reference = otpType == OtpType.EMAIL ? user.email : user.mobile;
    //TODO: check if user has not complete onboarding
    await this.userOtpService.sendOTP(
      otpType,
      reference,
      OtpPurpose.VERIFICATION,
      user.id,
    );
    return new StandardResponse(false, 'OTP_SEND_SUCCESSFULLY');
  }

  async verifyOTP(otpRequestDto: OtpRequestDto) {
    const { otp, otpType } = otpRequestDto;
    const user = await this.commonService.getLoggedInUser();
    const reference = otpType == OtpType.EMAIL ? user.email : user.mobile;

    await this.userOtpService.verifyOTP(otp, reference, user.id, otpType, true);
    await this.onboardingService.createOnBoarding(
      user,
      otpType == OtpType.EMAIL
        ? OnboardingType.EMAIL_VERIFIED
        : OnboardingType.MOBILE_VERIFIED,
    );
    return new StandardResponse(false, `${otpType}_VERIFIED_SUCCESSFULLY`);
  }

  async sendPasswordResetOTP(passwordResetRequest: PasswordResetRequest) {
    const identifierIsEmail = passwordResetRequest.emailOrMobile.includes('@');
    const typeMatchesIdentifier =
      (identifierIsEmail && passwordResetRequest.otpType === OtpType.EMAIL) ||
      (!identifierIsEmail && passwordResetRequest.otpType === OtpType.MOBILE);
    if (!typeMatchesIdentifier) {
      return new StandardResponse(false, 'OTP_SEND_SUCCESSFULLY');
    }

    const user = await this.userService.findByEmailOrMobile(
      passwordResetRequest.emailOrMobile,
    );
    if (!user) {
      return new StandardResponse(false, 'OTP_SEND_SUCCESSFULLY');
    }

    const otpType = passwordResetRequest.otpType;
    const reference = otpType === OtpType.EMAIL ? user.email : user.mobile;
    if (!reference) {
      return new StandardResponse(false, 'OTP_SEND_SUCCESSFULLY');
    }
    try {
      await this.userOtpService.sendOTP(
        otpType,
        reference,
        OtpPurpose.PASSWORD_RESET,
        user.id,
      );
    } catch (error) {
      // Keep resend/collision behavior indistinguishable from an unknown
      // account while the database-level cooldown still blocks the request.
      if (error instanceof HttpException && error.getStatus() === 429) {
        return new StandardResponse(false, 'OTP_SEND_SUCCESSFULLY');
      }
      throw error;
    }
    return new StandardResponse(false, 'OTP_SEND_SUCCESSFULLY');
  }

  async verifyPasswordResetOTP(dto: VerifyPasswordOtpDto) {
    const identifierIsEmail = dto.emailOrMobile.includes('@');
    if (
      (identifierIsEmail && dto.otpType !== OtpType.EMAIL) ||
      (!identifierIsEmail && dto.otpType !== OtpType.MOBILE)
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_OR_EXPIRED_OTP'),
      );
    }
    const user = await this.userService.findByEmailOrMobile(dto.emailOrMobile);
    if (!user) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_OR_EXPIRED_OTP'),
      );
    }
    const reference = dto.otpType === OtpType.EMAIL ? user.email : user.mobile;
    await this.userOtpService.verifyOTP(
      dto.otp,
      reference,
      user.id,
      dto.otpType,
      false,
      OtpPurpose.PASSWORD_RESET,
    );
    return new StandardResponse(false, 'OTP_VERIFIED_SUCCESSFULLY');
  }

  async verifyAndResetPassword(passwordResetDto: PasswordRequestDto) {
    const { otp, otpType, password, emailOrMobile } = passwordResetDto;
    const identifierIsEmail = emailOrMobile.includes('@');
    if (
      (identifierIsEmail && otpType !== OtpType.EMAIL) ||
      (!identifierIsEmail && otpType !== OtpType.MOBILE)
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_OR_EXPIRED_OTP'),
      );
    }
    const user = await this.userService.findByEmailOrMobile(emailOrMobile);
    if (!user) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_OR_EXPIRED_OTP'),
      );
    }

    const reference = otpType === OtpType.EMAIL ? user.email : user.mobile;
    await this.userOtpService.verifyOTP(
      otp,
      reference,
      user.id,
      otpType,
      false,
      OtpPurpose.PASSWORD_RESET,
    );

    const hashedPassword = await bcrypt.hash(password, 10);
    await this.usersRepository.manager.transaction(async (manager) => {
      const consumeResult = await manager.update(
        UserOtp,
        {
          otp,
          reference,
          userId: user.id,
          otpType,
          purpose: OtpPurpose.PASSWORD_RESET,
          isActive: true,
          used: false,
          failedAttempts: LessThan(5),
          expiryDate: MoreThan(new Date()),
        },
        { used: true },
      );

      if (consumeResult.affected !== 1) {
        throw new BadRequestException(
          new StandardResponse(true, 'INVALID_OR_EXPIRED_OTP'),
        );
      }

      const passwordResult = await manager.update(
        Users,
        { id: user.id },
        { password: hashedPassword },
      );
      if (passwordResult.affected !== 1) {
        throw new BadRequestException(
          new StandardResponse(true, 'PASSWORD_RESET_FAILED'),
        );
      }

      await manager.increment(Users, { id: user.id }, 'sessionVersion', 1);
    });

    await this.userService.invalidateUserCaches(user);
    return new StandardResponse(false, `PASSWORD_RESET_SUCCESSFULLY`);
  }

  private generateJwt(user: Users) {
    const payload: JwtPayload = {
      userId: user.id,
      role: user.userRole,
      adminRole: user.adminRole,
      sessionVersion: user.sessionVersion ?? 0,
    };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
  async changePassword(changePasswordDto: ChangePasswordDto) {
    const { newPassword, oldPassword, emailOrMobile } = changePasswordDto;
    const user = await this.userService.findByEmailOrMobile(emailOrMobile);
    if (!user) {
      throw new NotFoundException(new StandardResponse(true, 'USER_NOT_FOUND'));
    }

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'INCORRECT_OLD_PASSWORD'),
      );
    }

    await this.userService.setPasssword(user.id, newPassword);
    return new StandardResponse(false, 'PASSWORD_CHANGED_SUCCESSFULLY');
  }
  async deleteUser() {
    const loggedInUser = await this.commonService.getLoggedInUser();
    if (!loggedInUser?.id || !loggedInUser?.email) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_USER_SESSION'),
      );
    }

    await this.deletePlatformAccountUseCase.execute(
      loggedInUser.id,
      loggedInUser.email,
    );
    return new StandardResponse(false, 'USER_PERMANENTLY_DELETED');
  }

  /**
   * Admin Login Step 1: Validate credentials and send OTP
   * Returns a temporary login token (not a full auth token)
   */
  async adminLoginStep1(email: string, password: string) {
    // Find user by email
    const user = await this.userService.findByEmailOrMobileWithRelation(email);
    if (!user) {
      throw new NotFoundException(new StandardResponse(true, 'USER_NOT_FOUND'));
    }

    // Check if user is admin
    if (user.userRole !== UserRoles.ADMIN) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'ADMIN_ACCESS_REQUIRED'),
      );
    }

    // Validate password
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'INCORRECT_PASSWORD'),
      );
    }

    // Generate a temporary login token (short-lived, just for OTP verification)
    const loginToken = this.jwtService.sign(
      { userId: user.id, purpose: 'admin-login-otp' },
      { expiresIn: '10m' }, // Token valid for 10 minutes
    );

    // Send OTP to admin's email - use sendOTPForUser to ensure correct userId is used
    const userName =
      `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Admin';
    await this.userOtpService.sendOTPForUser(user.id, user.email, userName);

    // Store the login token temporarily in Redis (keyed by email)
    // Using cacheManager directly to set TTL (10 minutes = 600000ms)
    const cacheKey = `admin-login:${email}`;
    const cacheValue = { loginToken, userId: user.id };
    await this.redisCacheService['cacheManager'].set(
      cacheKey,
      cacheValue,
      600000,
    );

    return new StandardResponse(false, 'OTP_SENT_SUCCESSFULLY', {
      loginToken,
      message: 'Verification code sent to your email',
    });
  }

  /**
   * Admin Login Step 2: Verify OTP and complete login
   * Returns the actual auth token
   */
  async adminLoginStep2(email: string, otp: string, loginToken: string) {
    // Verify the login token
    let tokenPayload: any;
    try {
      tokenPayload = this.jwtService.verify(loginToken);
      if (tokenPayload.purpose !== 'admin-login-otp') {
        throw new Error('Invalid token purpose');
      }
    } catch (error) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'INVALID_OR_EXPIRED_LOGIN_TOKEN'),
      );
    }

    // Verify the cached login state
    const cachedData: any = await this.redisCacheService.getCachedItem(
      `admin-login:${email}`,
    );
    if (!cachedData || cachedData.loginToken !== loginToken) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'LOGIN_SESSION_EXPIRED'),
      );
    }

    // Get the user (for generating the response)
    const user = await this.userService.findByEmailOrMobileWithRelation(email);
    if (!user) {
      throw new NotFoundException(new StandardResponse(true, 'USER_NOT_FOUND'));
    }

    // IMPORTANT: Use cachedData.userId for OTP verification - this is the same userId
    // that was used when sendOTPForUser was called in step 1
    const otpUserId = cachedData.userId;

    // Verify the OTP
    await this.userOtpService.verifyOTP(
      otp,
      email,
      otpUserId,
      OtpType.EMAIL,
      true,
      OtpPurpose.ADMIN_LOGIN,
    );

    // Clear the temporary login state
    await this.redisCacheService.deleteCachedItem(`admin-login:${email}`);

    // Generate the actual auth token
    const userDto = new UserMapper().mapUserToDto(user);
    const auth = this.generateJwt(user);

    return new StandardResponse(false, 'AUTHENTICATED_SUCCESSFULLY', {
      user: userDto,
      access_token: auth.access_token,
    });
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { StandardResponse } from 'src/common/module/standard-response';
import { OnboardingService } from 'src/onboarding/onboarding.service';
import { CommonService } from '../../common/common.service';
import { UserLocationsService } from './user-locations.service';
import { UsersService } from './users.service';
import { UserMapper } from './user-mapper.service';
import { OnboardingType } from '../../onboarding/model/stage.enum';
import { UpdateVendorPayoutDto } from '../model/dto/update-vendor-payout-details.dto';
import { UserRoles } from '../model/user-roles.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from '../model/users.entity';
import { Repository } from 'typeorm';
import { VendorPayoutDetails } from '../model/vendor-payout.entity';

@Injectable()
export class UsersDetailsService {
  constructor(
    private readonly userService: UsersService,
    private readonly onboardingService: OnboardingService,
    private readonly commonService: CommonService,
    private readonly userLocationsService: UserLocationsService,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
  ) { }

  async setLocation(locationId: string) {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const location =
      await this.userLocationsService.getLocationById(locationId);
    const user = await this.userService.findById(authenticatedUser.id);
    user.location = location;
    user.locationId = location.id;
    this.onboardingService.createOnBoarding(user, OnboardingType.SET_LOCATION);
    await this.userService.updateUser(user);

    return new StandardResponse(false, 'LOCATION_UPDATED_SUCCESSFULLY');
  }

  async setProfilePic(profilePic: string) {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const user = await this.userService.findById(authenticatedUser.id);
    user.profilePic = profilePic;
    await this.userService.updateUser(user);
  }

  async getUserDetails() {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const user = await this.userService.getUserDetails(authenticatedUser.id);

    return new StandardResponse(
      false,
      'USER_DETAILS_FETCHED',
      new UserMapper().mapUserDetails(user),
    );
  }
  async updateVendorPayoutDetails(payload: UpdateVendorPayoutDto) {
    const loggedInUser = await this.commonService.getLoggedInUser();

    const user = await this.usersRepository.findOne({
      where: { id: loggedInUser.id },
      relations: ['payoutDetails'],
    });

    if (user.userRole !== UserRoles.VENDOR && user.userRole !== UserRoles.DOCTOR) {
      throw new BadRequestException(
        new StandardResponse(true, 'ONLY_VENDOR_OR_DOCTOR_CAN_UPDATE_PAYOUT_DETAILS'),
      );
    }

    if (!user.payoutDetails) {
      user.payoutDetails = new VendorPayoutDetails();
      user.payoutDetails.user = user;
    }

    user.payoutDetails.accountName = payload.accountName;
    user.payoutDetails.accountNumber = payload.accountNumber;
    user.payoutDetails.bankCode = payload.bankCode;
    user.payoutDetails.bankName = payload.bankName;
    user.payoutDetails.recipientCode = null;

    await this.usersRepository.save(user);

    return new StandardResponse(false, 'PAYOUT_DETAILS_UPDATED_SUCCESSFULLY');
  }

  async getVendorPayoutDetails() {
    const loggedInUser = await this.commonService.getLoggedInUser();

    const user = await this.usersRepository.findOne({
      where: { id: loggedInUser.id },
      relations: ['payoutDetails'],
    });
    if (user.userRole !== UserRoles.VENDOR && user.userRole !== UserRoles.DOCTOR) {
      throw new BadRequestException(
        new StandardResponse(true, 'ONLY_VENDOR_OR_DOCTOR_CAN_ACCESS_PAYOUT_DETAILS'),
      );
    }

    if (!user.payoutDetails) {
      throw new BadRequestException(
        new StandardResponse(true, 'PAYOUT_DETAILS_NOT_FOUND'),
      );
    }

    return new StandardResponse(
      false,
      'PAYOUT_DETAILS_FETCHED',
      user.payoutDetails,
    )
  }
}

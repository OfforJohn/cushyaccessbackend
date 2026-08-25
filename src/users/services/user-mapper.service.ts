import { UsersDto } from '../model/dto/user-dto';
import { Users } from '../model/users.entity';
import { UserLocationsDto } from '../model/dto/user-locations.dto';
import { UserLocations } from '../model/user-locations.entity';
import { RegisterUserDto } from '../model/dto/regsiter-user.dto';
import { OnboardingType } from '../../onboarding/model/stage.enum';
import { ReceipientDto } from '../model/dto/receipent.dto';
import { UserCredentials } from '../model/user-credentials.entity';
import { UserCredentialResponse } from '../model/dto/user-crednetial.response';
import { getBirthdayUpdatesRemaining } from '../birthday-policy';

export class UserMapper {
  mapUserToDto(user: Users): UsersDto {
    const usersDto = new UsersDto();
    usersDto.id = user.id;
    usersDto.firstName = user.firstName;
    usersDto.lastName = user.lastName;
    usersDto.dateOfBirth = user.dateOfBirth;
    usersDto.birthdayUpdatesRemaining =
      UserMapper.getBirthdayUpdatesRemaining(user);
    usersDto.location = user?.location?.address;
    usersDto.userRole = user?.userRole;
    usersDto.adminRole = user?.adminRole;
    usersDto.email = user?.email;
    usersDto.mobile = user?.mobile;
    usersDto.callingCode = user?.callingCode;

    const hasVerified = user?.onboardings?.some(
      (onboarding) =>
        onboarding.onboardingType == OnboardingType.EMAIL_VERIFIED ||
        onboarding.onboardingType == OnboardingType.MOBILE_VERIFIED,
    );

    if (hasVerified) {
      usersDto.hasVerify = true;
    } else {
      usersDto.hasVerify = false;
    }

    const hasSetLocation = user?.onboardings?.some(
      (onboarding) => onboarding.onboardingType == OnboardingType.SET_LOCATION,
    );
    if (hasSetLocation) {
      usersDto.hasSetLocation = true;
    } else {
      usersDto.hasSetLocation = false;
    }
    return usersDto;
  }

  mapToUser(registerUserDto: RegisterUserDto) {
    const {
      firstName,
      lastName,
      email,
      mobile,
      callingCode,
      countryCode,
      username,
      dateOfBirth,
    } = registerUserDto;
    const newUser = new Users();
    newUser.firstName = firstName.trim();
    newUser.email = email;
    newUser.countryCode = countryCode;
    newUser.callingCode = callingCode;
    newUser.lastName = lastName.trim();
    newUser.mobile = mobile;
    newUser.username = username;
    newUser.dateOfBirth = dateOfBirth ?? null;
    return newUser;
  }

  mapUserDetails(user: Users): UsersDto {
    const usersDto = new UsersDto();
    usersDto.id = user.id;
    usersDto.firstName = user.firstName;
    usersDto.lastName = user.lastName;
    usersDto.dateOfBirth = user.dateOfBirth;
    usersDto.birthdayUpdatesRemaining =
      UserMapper.getBirthdayUpdatesRemaining(user);
    usersDto.email = user.email;
    usersDto.mobile = user.mobile;
    usersDto.location = user.location?.address;
    usersDto.userRole = user.userRole;
    usersDto.profilePic = user.profilePic;
    usersDto.callingCode = user.callingCode;
    return usersDto;
  }

  mapUserLocationsToDto(userLocation: UserLocations): UserLocationsDto {
    return new UserLocationsDto(
      userLocation.id,
      userLocation.country,
      userLocation.state,
      userLocation.address,
      userLocation.landMark,
      userLocation.latitude,
      userLocation.longitude,
      userLocation.isSupported,
      userLocation.city,
      userLocation.placeId,
    );
  }

  mapUserLocationsListToDto(
    userLocations: UserLocations[],
  ): UserLocationsDto[] {
    return userLocations.map(this.mapUserLocationsToDto);
  }

  mapToRecipientDto(user: Users): ReceipientDto {
    const recipient = new ReceipientDto();
    recipient.id = user.id;
    recipient.firstName = user.firstName;
    recipient.lastName = user.lastName;
    recipient.userRole = user.userRole;
    recipient.isSuspended = false; // todo check if user is suspended
    return recipient;
  }

  static mapCrendentialsToDTO(entity: UserCredentials): UserCredentialResponse {
    const dto = new UserCredentialResponse();
    dto.id = entity.id;
    dto.governmentId = entity.governmentId;
    dto.bvn = entity.bvn;
    dto.cacURL = entity.cacURL;
    dto.proofOfAddressURL = entity.proofOfAddressURL;
    dto.pharmacyLicenseURL = entity.pharmacyLicenseURL;
    dto.status = entity.status;
    dto.reason = entity.reason;
    dto.vendorCategory = entity.vendorCategory;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }

  private static getBirthdayUpdatesRemaining(user: Users) {
    return getBirthdayUpdatesRemaining(
      user.dateOfBirthUpdateYear,
      user.dateOfBirthUpdateCount,
    );
  }
}

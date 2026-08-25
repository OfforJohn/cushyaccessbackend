import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager, ILike, In, Repository } from 'typeorm';
import { Users } from '../model/users.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { RegisterUserDto } from '../model/dto/regsiter-user.dto';
import * as bcrypt from 'bcryptjs';
import { StandardResponse } from 'src/common/module/standard-response';
import { OnboardingService } from 'src/onboarding/onboarding.service';
import { UserRoles } from '../model/user-roles.enum';
import { AdminRole } from '../model/admin-roles.enum';
import { UserMapper } from './user-mapper.service';
import { RedisCacheService } from '../../redis-cache/redis-cache.service';
import {
  getBirthdayUpdatesRemaining,
  getLagosCalendarYear,
  MAX_BIRTHDAY_UPDATES_PER_YEAR,
} from '../birthday-policy';
import { EventBus } from '@nestjs/cqrs';
import { BirthdayUpdatedEvent } from '../events/birthday-updated.event';
import {
  getCanonicalPhoneIdentity,
  getLoginPhoneIdentities,
  getNormalizedCountryCallingCode,
  getPhoneCandidates,
  normalizeStoredPhone,
} from './user-identifier';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly onboardingService: OnboardingService,
    private readonly redisCacheService: RedisCacheService,
    private readonly eventBus: EventBus,
  ) {}

  async registerUser(
    registerUserDto: RegisterUserDto,
    role: UserRoles,
    businessName?: string,
    manager?: EntityManager,
  ): Promise<Users> {
    const normalizedCountryCode = registerUserDto.countryCode
      .trim()
      .toUpperCase();
    const normalizedCallingCode =
      getNormalizedCountryCallingCode(normalizedCountryCode) ||
      registerUserDto.callingCode.replace(/\D/g, '');
    const normalizedRegistration = {
      ...registerUserDto,
      email: registerUserDto.email.trim().toLowerCase(),
      callingCode: normalizedCallingCode,
      countryCode: normalizedCountryCode,
      mobile: normalizeStoredPhone(
        registerUserDto.mobile,
        normalizedCallingCode,
        normalizedCountryCode,
      ),
    };
    if (registerUserDto.dateOfBirth) {
      this.assertValidDateOfBirth(registerUserDto.dateOfBirth);
    }
    const newUser = new UserMapper().mapToUser(normalizedRegistration);
    newUser.userRole = role;
    newUser.businessName = businessName;
    const hash = await this.hashPassword(registerUserDto.password);
    newUser.password = hash;

    const persist = async (transactionManager: EntityManager) => {
      const repository = transactionManager.getRepository(Users);
      const canonicalPhone = getCanonicalPhoneIdentity(
        normalizedRegistration.mobile,
        normalizedRegistration.callingCode,
        normalizedRegistration.countryCode,
      );
      const identityLocks = [
        `user-email:${normalizedRegistration.email}`,
        `user-phone:${canonicalPhone}`,
      ]
        .filter((value, index, values) => values.indexOf(value) === index)
        .sort();
      for (const identityLock of identityLocks) {
        await transactionManager.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [identityLock],
        );
      }
      await this.validate(
        normalizedRegistration.email,
        normalizedRegistration.mobile,
        normalizedRegistration.callingCode,
        normalizedRegistration.countryCode,
        repository,
      );
      return repository.save(newUser);
    };

    const user = manager
      ? await persist(manager)
      : await this.usersRepository.manager.transaction(persist);
    // An outer transaction has not committed yet, so its caller must not
    // publish/cache data that could still roll back.
    if (!manager) {
      await this.redisCacheService.setItemInCache(`user:${user.id}`, user);
      if (user.dateOfBirth) {
        this.eventBus.publish(new BirthdayUpdatedEvent(user.id));
      }
    }
    return user;
  }

  async setPassword(password: string, user: Users) {
    await this.onboardingService.hasEmailMobileOnboarded(user.id);
    const hash = await this.hashPassword(password);

    user.password = hash;
    user.completedOnboarding = true;
    await this.usersRepository.save(user);
    return new StandardResponse(false, 'PASSWORD_SET_SUCCESSFULLY');
  }

  async registerDefaultAppAdmin() {
    const email = 'ornagleinc@gmail.com';
    const password = '123456';
    const firstName = 'Cushy';
    const lastName = 'Access';
    const mobile = '9139232642';

    const existingUser = await this.usersRepository.exists({
      where: { email },
    });

    if (existingUser) return;

    const newUser = new Users();
    const hash = await this.hashPassword(password);
    newUser.firstName = firstName;
    newUser.email = email;
    newUser.lastName = lastName;
    newUser.mobile = mobile;
    newUser.password = hash;
    newUser.userRole = UserRoles.ADMIN;
    newUser.adminRole = AdminRole.SUPER_ADMIN;

    await this.usersRepository.save(newUser);
    console.log('default admin registered');
  }

  async findByEmailOrMobile(emailOrMobile: string) {
    const users = await this.findUsersByEmailOrMobile(emailOrMobile, [
      'location',
    ]);
    return users.length === 1 ? users[0] : undefined;
  }

  async findByEmailOrMobileWithRelation(emailOrMobile: string) {
    const users = await this.findUsersByEmailOrMobile(emailOrMobile, [
      'location',
      'onboardings',
      'professionDetails',
    ]);
    return users.length === 1 ? users[0] : undefined;
  }

  private async findUsersByEmailOrMobile(
    emailOrMobile: string,
    relations: string[],
  ): Promise<Users[]> {
    const input = emailOrMobile.trim();
    if (!input) return [];
    const isEmail = input.includes('@');
    const normalized = isEmail ? input.toLowerCase() : input.replace(/\D/g, '');
    if (isEmail) {
      return this.usersRepository.find({
        where: { email: ILike(normalized) },
        relations,
        take: 2,
      });
    }

    const phoneIdentities = getLoginPhoneIdentities(input);
    if (phoneIdentities.length === 0) return [];
    let query = this.usersRepository
      .createQueryBuilder('candidate_user')
      .where(
        `(
          regexp_replace(COALESCE(candidate_user."callingCode", ''), '[^0-9]', '', 'g') ||
          CASE
            WHEN regexp_replace(COALESCE(candidate_user."callingCode", ''), '[^0-9]', '', 'g') = '234'
              THEN ltrim(regexp_replace(candidate_user."mobile", '[^0-9]', '', 'g'), '0')
            ELSE regexp_replace(candidate_user."mobile", '[^0-9]', '', 'g')
          END
        ) IN (:...phoneIdentities)`,
        { phoneIdentities },
      )
      .take(2);
    relations.forEach((relation, index) => {
      query = query.leftJoinAndSelect(
        `candidate_user.${relation}`,
        `identifier_relation_${index}`,
      );
    });
    return query.getMany();
  }

  async findById(id: string): Promise<Users | undefined> {
    const cacheKey = `user:${id}`;

    const cachedUser = await this.redisCacheService.getCachedItem(cacheKey);
    if (cachedUser) return cachedUser as Users;

    const user = await this.usersRepository.findOne({
      where: { id },
    });

    await this.redisCacheService.setItemInCache(cacheKey, user);
    return user;
  }

  async findAuthUserById(id: string): Promise<Users | undefined> {
    return this.usersRepository.findOne({
      where: { id },
      select: [
        'id',
        'email',
        'mobile',
        'callingCode',
        'countryCode',
        'firstName',
        'lastName',
        'userRole',
        'adminRole',
        'sessionVersion',
      ],
    });
  }

  private async validate(
    email: string,
    mobile: string,
    callingCode: string,
    countryCode: string,
    repository: Repository<Users> = this.usersRepository,
  ) {
    const phoneCandidates = getPhoneCandidates(
      mobile,
      callingCode,
      countryCode,
    );
    const existingUsers = await repository.find({
      where: [
        { email: ILike(email) },
        ...(phoneCandidates.length ? [{ mobile: In(phoneCandidates) }] : []),
      ],
    });
    const existingUserWithEmail = existingUsers.some(
      (user) => user.email?.trim().toLowerCase() === email,
    );

    if (existingUserWithEmail) {
      throw new BadRequestException(
        new StandardResponse(true, 'EXISTING_USER_WITH_EMAIL'),
      );
    }

    const canonicalPhone = getCanonicalPhoneIdentity(
      mobile,
      callingCode,
      countryCode,
    );
    const existingUserWithMobile = existingUsers.some(
      (user) =>
        getCanonicalPhoneIdentity(
          user.mobile || '',
          user.callingCode || '234',
          user.countryCode ||
            ((user.callingCode || '234').replace(/\D/g, '') === '234'
              ? 'NG'
              : ''),
        ) === canonicalPhone,
    );

    if (existingUserWithMobile) {
      throw new BadRequestException(
        new StandardResponse(true, 'EXISTING_USER_WITH_MOBILE'),
      );
    }
  }

  async updateUser(user: Users): Promise<Users> {
    const updatedUser = await this.usersRepository.save(user);
    await this.redisCacheService.setItemInCache(`user:${user.id}`, user);
    await this.redisCacheService.deleteCachedItem(`user:location:${user.id}`);

    return updatedUser;
  }

  async updateDateOfBirth(userId: string, dateOfBirth: string) {
    this.assertValidDateOfBirth(dateOfBirth);
    const currentYear = getLagosCalendarYear();

    const result = await this.usersRepository.manager.transaction(
      async (manager) => {
        const repository = manager.getRepository(Users);
        const user = await repository
          .createQueryBuilder('user')
          .setLock('pessimistic_write')
          .where('user.id = :userId', { userId })
          .getOne();

        if (!user) {
          throw new BadRequestException(
            new StandardResponse(true, 'USER_NOT_FOUND'),
          );
        }

        if (user.dateOfBirth === dateOfBirth) {
          return { user, changed: false };
        }

        const usedThisYear =
          user.dateOfBirthUpdateYear === currentYear
            ? Number(user.dateOfBirthUpdateCount || 0)
            : 0;

        if (usedThisYear >= MAX_BIRTHDAY_UPDATES_PER_YEAR) {
          throw new BadRequestException(
            new StandardResponse(true, 'BIRTHDAY_UPDATE_LIMIT_REACHED'),
          );
        }

        user.dateOfBirth = dateOfBirth;
        user.dateOfBirthUpdateYear = currentYear;
        user.dateOfBirthUpdateCount = usedThisYear + 1;
        user.dateOfBirthUpdatedAt = new Date();
        return {
          user: await repository.save(user),
          changed: true,
        };
      },
    );
    const updatedUser = result.user;

    await Promise.all([
      this.redisCacheService.setItemInCache(
        `user:${updatedUser.id}`,
        updatedUser,
      ),
      this.redisCacheService.deleteCachedItem(
        `user:location:${updatedUser.id}`,
      ),
      this.redisCacheService.deleteCachedItem(
        `user:email:mobile:${updatedUser.email}`,
      ),
      this.redisCacheService.deleteCachedItem(
        `user:email:mobile:${updatedUser.mobile}`,
      ),
    ]);

    if (result.changed) {
      this.eventBus.publish(new BirthdayUpdatedEvent(updatedUser.id));
    }

    return {
      dateOfBirth: updatedUser.dateOfBirth,
      birthdayUpdatesRemaining: getBirthdayUpdatesRemaining(
        updatedUser.dateOfBirthUpdateYear,
        updatedUser.dateOfBirthUpdateCount,
      ),
    };
  }

  async getUserDetails(id: string) {
    const cacheKey = `user:location:${id}`;
    const cachedUser = await this.redisCacheService.getCachedItem(cacheKey);
    if (cachedUser) return cachedUser as Users;
    const user = await this.usersRepository.findOne({
      where: { id },
      relations: ['location'],
    });

    await this.redisCacheService.setItemInCache(cacheKey, user);
    return user;
  }

  async setPasssword(userId: string, password: string) {
    const hashedPassword = await this.hashPassword(password);
    const result = await this.usersRepository.update(
      { id: userId },
      { password: hashedPassword },
    );
    if (result.affected !== 1) {
      throw new BadRequestException(
        new StandardResponse(true, 'USER_NOT_FOUND'),
      );
    }
    await this.invalidateUserCaches({ id: userId });
  }

  async invalidateUserCaches(
    user: Pick<Users, 'id'> & Partial<Pick<Users, 'email' | 'mobile'>>,
  ) {
    await Promise.allSettled([
      this.redisCacheService.deleteCachedItem(`user:${user.id}`),
      this.redisCacheService.deleteCachedItem(`user:location:${user.id}`),
      ...(user.email
        ? [
            this.redisCacheService.deleteCachedItem(
              `user:email:mobile:${user.email}`,
            ),
          ]
        : []),
      ...(user.mobile
        ? [
            this.redisCacheService.deleteCachedItem(
              `user:email:mobile:${user.mobile}`,
            ),
          ]
        : []),
    ]);
  }

  async findByRole(userRole: UserRoles) {
    return this.usersRepository.find({ where: { userRole } });
  }

  // Helper functions

  private async hashPassword(password: string) {
    const saltOrRounds = 10;
    const hash = await bcrypt.hash(password, saltOrRounds);
    return hash;
  }
  async verifyVendor(userId: string) {
    void userId;
    // const user = await this.findById(userId);
    // if (!user) {
    //   throw new BadRequestException(
    //     new StandardResponse(true, 'USER_NOT_FOUND'),
    //   );
    // }
    // user.isVendorVerified = true;
    // const updatedUser = await this.usersRepository.save(user);
    // if (!updatedUser) {
    //   throw new BadRequestException(
    //     new StandardResponse(true, 'VENDOR_VERIFICATION_FAILED'),
    //   );
    // }
    // return new StandardResponse(false, 'VENDOR_VERIFIED_SUCCESSFULLY');
  }
  async unVerifyVendor(userId: string) {
    void userId;
    // const user = await this.findById(userId);
    // if (!user) {
    //   throw new BadRequestException(
    //     new StandardResponse(true, 'USER_NOT_FOUND'),
    //   );
    // }
    // user.isVendorVerified = false;
    // const updatedUser = await this.usersRepository.save(user);
    // if (!updatedUser) {
    //   throw new BadRequestException(
    //     new StandardResponse(true, 'VENDOR_UNVERIFICATION_FAILED'),
    //   );
    // }
    // return new StandardResponse(false, 'VENDOR_UNVERIFIED_SUCCESSFULLY');
  }
  async isAdmin(userId: string): Promise<boolean> {
    if (!userId) {
      return false;
    }

    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: ['id', 'userRole'],
    });

    if (!user) {
      return false;
    }

    // Check if user is active and has admin role
    return user.userRole === UserRoles.ADMIN;
  }

  private assertValidDateOfBirth(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_DATE_OF_BIRTH'),
      );
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    const today = new Date();
    const todayUtc = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
    );

    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day ||
      parsed.getTime() > todayUtc
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_DATE_OF_BIRTH'),
      );
    }
  }
}

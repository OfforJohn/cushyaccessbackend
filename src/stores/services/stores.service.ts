import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Raw, Repository, SelectQueryBuilder } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Stores } from '../model/stores.entity';
import { OpeningSchedule } from '../model/opening-schedule.entity';
import { OpeningScheduleRequest } from '../model/dtos/opening-schedule.dto';
import { PaymentInfo } from '../model/payment-info.entity';
import { PaymentInfoRequest } from '../model/dtos/payment-info.dto';
import { CommonService } from '../../common/common.service';
import { DaySchedule } from '../model/day-schedules';
import { ScheduleTime } from '../model/enums/schedule-time.enum';
import { DeliveryType } from '../model/enums/delivery-type.enum';
import { StandardResponse } from '../../common/module/standard-response';
import { StoresDto } from '../model/dtos/store.dto';
import { UserLocationsService } from '../../users/services/user-locations.service';
import { Days } from '../model/enums/days.enum';
import { StoreCategory } from '../model/enums/store.category';
import { StoreMapper } from './stores.mapper';
import { AppSetting } from 'src/admin/models/app-settings.entity';
import {
  StoreAppealDto,
  SuspendStoreDto,
  UnsuspendStoreDto,
} from '../model/dtos/suspend-store.dto';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { Users } from 'src/users/model/users.entity';
import { JwtService } from '@nestjs/jwt';
import { UserCredentials } from 'src/users/model/user-credentials.entity';
import { UserCredentialStatus } from 'src/users/model/user-credential.enum';
import { MailSenderService } from 'src/user-otp/mail-sender.service';
import { UserOtpService } from 'src/user-otp/user-otp.service';
import { OtpPurpose } from 'src/user-otp/model/otp-purpose.enum';
import { OtpType } from 'src/user-otp/model/otp-type.enum';
import { Orders } from 'src/orders/model/order.entity';
import { OrderStatus } from 'src/orders/model/enum/order-status.enum';
import { UserRoles } from 'src/users/model/user-roles.enum';
import {
  ConfigureStorePasswordDto,
  CreateStoreAccessDto,
  ResetStorePasswordDto,
} from '../model/dtos/store-access.dto';

type StoreAvailability = {
  isOpen: boolean;
  isOrderable: boolean;
  isWithinOperatingHours: boolean;
  availabilityStatus:
    | 'OPEN'
    | 'MERCHANT_CLOSED'
    | 'OUTSIDE_OPERATING_HOURS'
    | 'STORE_SUSPENDED';
  availabilityLabel: string;
  nextOpeningLabel: string | null;
  orderDisabledReason: string | null;
};

const STORE_DAYS: Days[] = [
  Days.SUNDAY,
  Days.MONDAY,
  Days.TUESDAY,
  Days.WEDNESDAY,
  Days.THURSDAY,
  Days.FRIDAY,
  Days.SATURDAY,
];

const STORE_DAY_LABELS: Record<Days, string> = {
  [Days.SUNDAY]: 'Sunday',
  [Days.MONDAY]: 'Monday',
  [Days.TUESDAY]: 'Tuesday',
  [Days.WEDNESDAY]: 'Wednesday',
  [Days.THURSDAY]: 'Thursday',
  [Days.FRIDAY]: 'Friday',
  [Days.SATURDAY]: 'Saturday',
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const STORE_HAS_MENU_ITEMS_SQL =
  'EXISTS (SELECT 1 FROM menu_item eligible_menu_item WHERE eligible_menu_item."storeId" = store.id)';

const normalizeStoreEmail = (email: string) => email.trim().toLowerCase();

const normalizeStoreMobile = (mobile: string) => {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) {
    return `234${digits.slice(1)}`;
  }
  if (digits.length === 10) {
    return `234${digits}`;
  }
  return digits;
};

const normalizedStoredMobileSql = (alias: string) => {
  const digits = `regexp_replace(COALESCE(${alias}, ''), '[^0-9]', '', 'g')`;
  return `CASE
    WHEN LENGTH(${digits}) = 11 AND LEFT(${digits}, 1) = '0'
      THEN '234' || SUBSTRING(${digits} FROM 2)
    WHEN LENGTH(${digits}) = 10
      THEN '234' || ${digits}
    ELSE ${digits}
  END`;
};

const NIGERIAN_STATE_ALIAS_GROUPS: readonly (readonly string[])[] = [
  [
    'niger',
    'niger state',
    'minna',
    'suleja',
    'bida',
    'kontagora',
    'lapai',
    'madalla',
  ],
  [
    'fct',
    'fct abuja',
    'abuja fct',
    'federal capital territory',
    'abuja',
    'utako',
    'wuse',
    'gwarinpa',
    'maitama',
    'asokoro',
    'jabi',
    'garki',
    'kubwa',
    'lugbe',
  ],
  ['kwara', 'kwara state', 'ilorin'],
  ['lagos', 'lagos state', 'ikeja', 'lekki', 'victoria island', 'ajah'],
  ['rivers', 'rivers state', 'port harcourt', 'ph'],
  ['plateau', 'plateau state', 'jos', 'jos plateau'],
  ['delta', 'delta state', 'asaba'],
  ['oyo', 'oyo state', 'ibadan'],
  ['bauchi', 'bauchi state'],
];

@Injectable()
export class StoreService {
  constructor(
    @InjectRepository(Stores)
    private readonly storeRepository: Repository<Stores>,
    @InjectRepository(OpeningSchedule)
    private readonly openingScheduleRepository: Repository<OpeningSchedule>,
    @InjectRepository(DaySchedule)
    private readonly dayScheduleRepository: Repository<DaySchedule>,
    @InjectRepository(PaymentInfo)
    private readonly paymentInfoRepository: Repository<PaymentInfo>,
    @InjectRepository(AppSetting)
    private readonly appSettingRepository: Repository<AppSetting>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(UserCredentials)
    private readonly userCredentialsRepository: Repository<UserCredentials>,
    private readonly commonService: CommonService,
    private readonly userLocationsService: UserLocationsService,
    private readonly analyticsService: AnalyticsService,
    private readonly jwtService: JwtService,
    private readonly mailSenderService: MailSenderService,
    private readonly userOtpService: UserOtpService,
  ) {}

  private getCurrentStoreDayAndTime(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Lagos',
      weekday: 'long',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);

    const getPart = (type: string) =>
      parts.find((part) => part.type === type)?.value;

    let hour = Number(getPart('hour') || 0);
    if (hour === 24) hour = 0;

    const day = (getPart('weekday') || '').toLowerCase() as Days;
    return {
      day,
      dayIndex: STORE_DAYS.indexOf(day),
      minutes: hour * 60 + Number(getPart('minute') || 0),
    };
  }

  private scheduleTimeToMinutes(time?: string): number | null {
    if (!time) return null;

    const match = /^(\d{1,2})(AM|PM)$/i.exec(time.trim());
    if (!match) return null;

    const period = match[2].toUpperCase();
    let hour = Number(match[1]);

    if (period === 'AM') {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }

    return hour * 60;
  }

  private getOperatingStatus(
    store: Stores,
    now = new Date(),
    findFollowingOpening = false,
  ) {
    const schedules = store.openingSchedules?.schedules;
    if (!schedules?.length) {
      return { isWithinOperatingHours: true, nextOpeningLabel: null };
    }

    const { dayIndex, minutes } = this.getCurrentStoreDayAndTime(now);
    if (dayIndex < 0) {
      return { isWithinOperatingHours: true, nextOpeningLabel: null };
    }

    const scheduleByDay = new Map(
      schedules.map((schedule) => [schedule.day, schedule]),
    );
    const getTimes = (index: number) => {
      const schedule = scheduleByDay.get(STORE_DAYS[index]);
      const open = this.scheduleTimeToMinutes(schedule?.openTime);
      const close = this.scheduleTimeToMinutes(schedule?.closeTime);
      return {
        schedule,
        open,
        close,
        isClosed: schedule?.isClosed === true,
      };
    };

    const today = getTimes(dayIndex);
    const previous = getTimes((dayIndex + 6) % 7);
    const openFromPreviousOvernight =
      !previous.isClosed &&
      previous.open !== null &&
      previous.close !== null &&
      previous.open > previous.close &&
      minutes < previous.close;
    const openToday =
      !today.isClosed &&
      today.open !== null &&
      today.close !== null &&
      (today.open === today.close ||
        (today.open < today.close
          ? minutes >= today.open && minutes < today.close
          : minutes >= today.open));

    const isWithinOperatingHours = openFromPreviousOvernight || openToday;
    if (isWithinOperatingHours && !findFollowingOpening) {
      return { isWithinOperatingHours: true, nextOpeningLabel: null };
    }

    for (let offset = 0; offset <= 7; offset += 1) {
      const candidateIndex = (dayIndex + offset) % 7;
      const candidate = getTimes(candidateIndex);
      if (
        !candidate.schedule ||
        candidate.isClosed ||
        candidate.open === null ||
        candidate.close === null
      ) {
        continue;
      }

      // Equal times retain the app's legacy meaning of a 24-hour day.
      // If a merchant manually closes, do not promise a same-day reopening.
      if (offset === 0 && candidate.open === candidate.close) {
        continue;
      }

      if (offset === 0 && minutes >= candidate.open) {
        continue;
      }

      const time = candidate.schedule.openTime;
      if (offset === 0) {
        return {
          isWithinOperatingHours,
          nextOpeningLabel: `Opens ${time}`,
        };
      }

      return {
        isWithinOperatingHours,
        nextOpeningLabel: `Re-opens ${STORE_DAY_LABELS[STORE_DAYS[candidateIndex]]} by ${time}`,
      };
    }

    return { isWithinOperatingHours, nextOpeningLabel: null };
  }

  getStoreAvailability(store: Stores, now = new Date()): StoreAvailability {
    const { isWithinOperatingHours, nextOpeningLabel } =
      this.getOperatingStatus(store, now, !store.isVisible);
    const closedLabel = nextOpeningLabel
      ? `Merchant Closed • ${nextOpeningLabel}`
      : 'Merchant Closed';

    if (store.isSuspended) {
      return {
        isOpen: false,
        isOrderable: false,
        isWithinOperatingHours,
        availabilityStatus: 'STORE_SUSPENDED',
        availabilityLabel: 'Merchant Closed',
        nextOpeningLabel: null,
        orderDisabledReason: 'STORE_SUSPENDED',
      };
    }

    if (!store.isVisible) {
      return {
        isOpen: false,
        isOrderable: false,
        isWithinOperatingHours,
        availabilityStatus: 'MERCHANT_CLOSED',
        availabilityLabel: closedLabel,
        nextOpeningLabel,
        orderDisabledReason: 'MERCHANT_CLOSED',
      };
    }

    if (!isWithinOperatingHours) {
      return {
        isOpen: false,
        isOrderable: false,
        isWithinOperatingHours,
        availabilityStatus: 'OUTSIDE_OPERATING_HOURS',
        availabilityLabel: closedLabel,
        nextOpeningLabel,
        orderDisabledReason: 'OUTSIDE_OPERATING_HOURS',
      };
    }

    return {
      isOpen: true,
      isOrderable: true,
      isWithinOperatingHours,
      availabilityStatus: 'OPEN',
      availabilityLabel: 'Open',
      nextOpeningLabel: null,
      orderDisabledReason: null,
    };
  }

  private applyAvailability(store: Stores): Stores {
    Object.assign(store as any, this.getStoreAvailability(store));
    return store;
  }

  async attachOpeningSchedules(stores: Stores[]): Promise<Stores[]> {
    const storeIds = stores.map((store) => store.id).filter(Boolean);
    if (storeIds.length === 0) return stores;

    const openingSchedules = await this.openingScheduleRepository.find({
      where: { storeId: In(storeIds) },
      relations: ['schedules'],
    });
    const schedulesByStoreId = new Map(
      openingSchedules.map((schedule) => [schedule.storeId, schedule]),
    );

    return stores.map((store) => {
      store.openingSchedules = schedulesByStoreId.get(store.id);
      return this.applyAvailability(store);
    });
  }

  async assertStoreCanAcceptOrders(storeId: string): Promise<Stores> {
    const store = await this.getStoreById(storeId);

    if (!(store as any).isOrderable) {
      throw new BadRequestException(
        new StandardResponse(
          true,
          (store as any).orderDisabledReason || 'STORE_CLOSED',
        ),
      );
    }

    return store;
  }

  async createStore(
    category: StoreCategory,
    dto: CreateStoreAccessDto,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const userId = authenticatedUser.id;
    const branchPasswordHash = await bcrypt.hash(dto.password, 10);

    const newStore = await this.storeRepository.manager.transaction(
      async (manager) => {
        // Prevent simultaneous branch creations from bypassing the merchant's
        // single-category branch rule.
        await manager.query(
          "SELECT pg_advisory_xact_lock(hashtext('store-create'), hashtext($1))",
          [userId],
        );
        const existingStore = await manager.findOne(Stores, {
          where: { userId },
          order: { id: 'ASC' },
        });
        if (existingStore && existingStore.category !== category) {
          throw new BadRequestException(
            new StandardResponse(
              true,
              'STORE_CATEGORY_MUST_MATCH_EXISTING_BRANCHES',
            ),
          );
        }

        const store = new Stores();
        store.category = category;
        store.userId = userId;
        store.branchPasswordHash = branchPasswordHash;
        store.branchPasswordUpdatedAt = new Date();
        await manager.save(Stores, store);

        const openingSchedule = new OpeningSchedule();
        openingSchedule.storeId = store.id;
        openingSchedule.userId = userId;
        openingSchedule.deliveryType = DeliveryType.DELIVERY;
        await manager.save(OpeningSchedule, openingSchedule);

        const daySchedules: DaySchedule[] = [];

        const sundaySchedule = new DaySchedule();
        sundaySchedule.day = Days.SUNDAY;
        sundaySchedule.openTime = ScheduleTime['8AM'];
        sundaySchedule.closeTime = ScheduleTime['3PM'];
        sundaySchedule.openingScheduleId = openingSchedule.id;
        daySchedules.push(sundaySchedule);

        const mondaySchedule = new DaySchedule();
        mondaySchedule.day = Days.MONDAY;
        mondaySchedule.openTime = ScheduleTime['8AM'];
        mondaySchedule.closeTime = ScheduleTime['6PM'];
        mondaySchedule.openingScheduleId = openingSchedule.id;
        daySchedules.push(mondaySchedule);

        const tuesdaySchedule = new DaySchedule();
        tuesdaySchedule.day = Days.TUESDAY;
        tuesdaySchedule.openTime = ScheduleTime['9AM'];
        tuesdaySchedule.closeTime = ScheduleTime['5PM'];
        tuesdaySchedule.openingScheduleId = openingSchedule.id;
        daySchedules.push(tuesdaySchedule);

        const wednesdaySchedule = new DaySchedule();
        wednesdaySchedule.day = Days.WEDNESDAY;
        wednesdaySchedule.openTime = ScheduleTime['9AM'];
        wednesdaySchedule.closeTime = ScheduleTime['5PM'];
        wednesdaySchedule.openingScheduleId = openingSchedule.id;
        daySchedules.push(wednesdaySchedule);

        const thursdaySchedule = new DaySchedule();
        thursdaySchedule.day = Days.THURSDAY;
        thursdaySchedule.openTime = ScheduleTime['9AM'];
        thursdaySchedule.closeTime = ScheduleTime['5PM'];
        thursdaySchedule.openingScheduleId = openingSchedule.id;
        daySchedules.push(thursdaySchedule);

        const fridaySchedule = new DaySchedule();
        fridaySchedule.day = Days.FRIDAY;
        fridaySchedule.openTime = ScheduleTime['9AM'];
        fridaySchedule.closeTime = ScheduleTime['5PM'];
        fridaySchedule.openingScheduleId = openingSchedule.id;
        daySchedules.push(fridaySchedule);

        const saturdaySchedule = new DaySchedule();
        saturdaySchedule.day = Days.SATURDAY;
        saturdaySchedule.openTime = ScheduleTime['10AM'];
        saturdaySchedule.closeTime = ScheduleTime['4PM'];
        saturdaySchedule.openingScheduleId = openingSchedule.id;
        daySchedules.push(saturdaySchedule);

        await manager.save(DaySchedule, daySchedules);
        return store;
      },
    );
    // Analytics must never turn a committed store creation into an apparent
    // failure that encourages the merchant to create a duplicate branch.
    await this.analyticsService
      .trackUserActivity(authenticatedUser.id, 'store_created')
      .catch(() => undefined);

    newStore.branchPasswordConfigured = true;
    delete newStore.branchPasswordHash;
    delete newStore.branchPasswordUpdatedAt;
    const [storeWithAvailability] = await this.attachOpeningSchedules([
      newStore,
    ]);
    return new StandardResponse(
      false,
      'STORE_CREATED_SUCCESSFULLY',
      storeWithAvailability,
    );
  }

  async createOrUpdateOpeningSchedule(
    storeId: string,
    openingScheduleDto: OpeningScheduleRequest,
  ): Promise<StandardResponse> {
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
    });

    const authenticatedUser = await this.commonService.getLoggedInUser();

    if (!store) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }

    if (authenticatedUser.id !== store.userId) {
      throw new NotFoundException(
        new StandardResponse(true, 'UNAUTHORIZED_ACTION'),
      );
    }

    const userId = store.userId;
    const openingSchedule = await this.openingScheduleRepository.findOne({
      where: { storeId: store.id, userId: userId },
      relations: ['schedules'],
    });

    if (!openingSchedule) {
      throw new BadRequestException(
        new StandardResponse(true, 'STORE_NOT_INITIALIZED'),
      );
    }
    openingSchedule.deliveryType = openingScheduleDto.deliveryType;

    const updatedDaySchdule = [];
    for (const schedule of openingSchedule.schedules) {
      let newTimes;

      switch (schedule.day) {
        case Days.SUNDAY:
          newTimes = openingScheduleDto.sunday;
          break;
        case Days.MONDAY:
          newTimes = openingScheduleDto.monday;
          break;
        case Days.TUESDAY:
          newTimes = openingScheduleDto.tuesday;
          break;
        case Days.WEDNESDAY:
          newTimes = openingScheduleDto.wednessday;
          break;
        case Days.THURSDAY:
          newTimes = openingScheduleDto.thursday;
          break;
        case Days.FRIDAY:
          newTimes = openingScheduleDto.friday;
          break;
        case Days.SATURDAY:
          newTimes = openingScheduleDto.saturday;
          break;
        default:
          continue;
      }

      const validTimes = Object.values(ScheduleTime);
      const nextOpenTime = validTimes.includes(newTimes.openTime)
        ? newTimes.openTime
        : schedule.openTime;
      const nextCloseTime = validTimes.includes(newTimes.closeTime)
        ? newTimes.closeTime
        : schedule.closeTime;

      // Closed days retain their previous times, so reopening the day does not
      // force the merchant to configure the hours again.
      if (
        schedule.openTime !== nextOpenTime ||
        schedule.closeTime !== nextCloseTime ||
        schedule.isClosed !== (newTimes.isClosed ?? false)
      ) {
        schedule.openTime = nextOpenTime;
        schedule.closeTime = nextCloseTime;
        schedule.isClosed = newTimes.isClosed ?? false;
        updatedDaySchdule.push(schedule);
      }
    }

    await this.openingScheduleRepository.save(openingSchedule);
    await this.dayScheduleRepository.save(updatedDaySchdule);

    return new StandardResponse(
      false,
      'SCHEDULE_UPDATED_SUCCESSFULLY',
      openingSchedule,
    );
  }

  async getOpeningSchedule(storeId: string): Promise<StandardResponse> {
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
    });

    if (!store) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }

    const openingSchedule = await this.openingScheduleRepository.findOne({
      where: { storeId: store.id },
      relations: ['schedules'],
    });

    return new StandardResponse(
      false,
      'SCHEDULE_FETCHED_SUCCESSFULLY',
      openingSchedule,
    );
  }
  async createOrUpdatePaymentInfo(
    storeId: string,
    paymentInfoDto: PaymentInfoRequest,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    let paymentInfo = await this.paymentInfoRepository.findOne({
      where: { id: storeId },
    });

    if (!paymentInfo) {
      paymentInfo = new PaymentInfo();
      paymentInfo.userId = authenticatedUser.id;
    }
    paymentInfo.accountName = paymentInfoDto.accountName;
    paymentInfo.accountNumber = paymentInfoDto.accountNumber;
    paymentInfo.bank = paymentInfoDto.bank;

    await this.paymentInfoRepository.save(paymentInfo);

    return new StandardResponse(
      false,
      'PAYMENT_INFO_UPDATED_SUCCESSFULLY',
      paymentInfo,
    );
  }

  async getPaymentInfo(storeId: string): Promise<StandardResponse> {
    const paymentInfo = await this.paymentInfoRepository.findOne({
      where: { id: storeId },
    });

    if (!paymentInfo) {
      return new StandardResponse(true, 'PAYMENT_INFO_NOT_FOUND');
    }

    return new StandardResponse(
      false,
      'PAYMENT_INFO_FETCHED_SUCCESSFULLY',
      paymentInfo,
    );
  }

  /* */
  async updateStore(
    storeId: string,
    storeDto: StoresDto,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const location = await this.userLocationsService.getLocationById(
      storeDto.addressId,
    );
    if (!location) {
      throw new NotFoundException(
        new StandardResponse(true, 'LOCATION_NOT_FOUND'),
      );
    }

    const normalizedEmail = normalizeStoreEmail(storeDto.email);
    const normalizedMobile = normalizeStoreMobile(storeDto.mobile);
    const identityLocks = [
      `store-email:${normalizedEmail}`,
      `store-mobile:${normalizedMobile}`,
    ].sort();

    return this.storeRepository.manager.transaction(async (manager) => {
      // Serialize claims for both identities. Sorting prevents deadlocks when
      // concurrent updates involve the same email and phone in reverse order.
      for (const identityLock of identityLocks) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          identityLock,
        ]);
      }

      const repository = manager.getRepository(Stores);
      const store = await repository.findOne({
        where: { id: storeId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!store) {
        throw new NotFoundException(
          new StandardResponse(true, 'STORE_NOT_FOUND'),
        );
      }

      if (
        authenticatedUser.id !== store.userId &&
        authenticatedUser.userRole !== UserRoles.ADMIN
      ) {
        throw new NotFoundException(
          new StandardResponse(true, 'UNAUTHORIZED_ACTION'),
        );
      }

      const emailExists = await repository.exists({
        where: {
          email: Raw((alias) => `LOWER(TRIM(${alias})) = :normalizedEmail`, {
            normalizedEmail,
          }),
          userId: Not(store.userId),
        },
      });

      if (emailExists) {
        return new StandardResponse(true, 'EMAIL_ALREADY_IN_USE');
      }

      const mobileExists = await repository.exists({
        where: {
          mobile: Raw(
            (alias) =>
              `${normalizedStoredMobileSql(alias)} = :normalizedMobile`,
            { normalizedMobile },
          ),
          userId: Not(store.userId),
        },
      });

      if (mobileExists) {
        return new StandardResponse(true, 'MOBILE_ALREADY_IN_USE');
      }

      store.name = storeDto.name;
      store.description = storeDto.description;
      store.coverImage = storeDto.coverImage;
      store.email = normalizedEmail;
      store.mobile = storeDto.mobile.trim();
      store.addressId = storeDto.addressId;

      await repository.save(store);

      return new StandardResponse(false, 'STORE_UPDATED_SUCCESSFULLY', store);
    });
  }

  async getStore(userIdOrStoreId: string): Promise<StandardResponse> {
    const store = await this.storeRepository.findOne({
      where: [{ userId: userIdOrStoreId }, { id: userIdOrStoreId }],
      relations: ['address'],
    });

    if (!store) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }
    const [storeWithAvailability] = await this.attachOpeningSchedules([store]);
    return new StandardResponse(
      false,
      'STORE_FETCHED_SUCCESSFULLY',
      storeWithAvailability,
    );
  }
  async getMyStores(): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const userId = authenticatedUser.id;
    const stores = await this.storeRepository
      .createQueryBuilder('store')
      .addSelect('store.branchPasswordHash')
      .leftJoinAndSelect('store.address', 'address')
      .where('store.userId = :userId', { userId })
      .orderBy('store.name', 'ASC', 'NULLS LAST')
      .addOrderBy('store.id', 'ASC')
      .getMany();
    stores.forEach((store) => this.markBranchPasswordStatus(store));
    return new StandardResponse(
      false,
      'STORE_FETCHED_SUCCESSFULLY',
      await this.attachOpeningSchedules(stores),
    );
  }

  async requestStoreDeletionOtp(storeId: string): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const store = await this.storeRepository.findOne({
      where: { id: storeId, userId: authenticatedUser.id },
    });
    if (!store) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }

    const storeCount = await this.storeRepository.count({
      where: { userId: authenticatedUser.id },
    });
    if (storeCount <= 1) {
      throw new BadRequestException(
        new StandardResponse(true, 'ONLY_STORE_CANNOT_BE_DELETED'),
      );
    }

    await this.assertStoreHasNoActiveOrders(storeId);
    if (!authenticatedUser.email) {
      throw new BadRequestException(
        new StandardResponse(true, 'ACCOUNT_EMAIL_NOT_FOUND'),
      );
    }

    await this.userOtpService.sendOTP(
      OtpType.EMAIL,
      authenticatedUser.email,
      OtpPurpose.STORE_DELETION,
      authenticatedUser.id,
      storeId,
    );

    return new StandardResponse(false, 'STORE_DELETION_OTP_SENT', {
      email: this.maskEmail(authenticatedUser.email),
    });
  }

  async deleteStore(storeId: string, otp: string): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    if (!authenticatedUser.email) {
      throw new BadRequestException(
        new StandardResponse(true, 'ACCOUNT_EMAIL_NOT_FOUND'),
      );
    }

    await this.userOtpService.verifyOTP(
      otp,
      authenticatedUser.email,
      authenticatedUser.id,
      OtpType.EMAIL,
      true,
      OtpPurpose.STORE_DELETION,
      storeId,
    );

    const result = await this.storeRepository.manager.transaction(
      async (manager) => {
        // Lock every store owned by this merchant so two simultaneous
        // deletions cannot remove the final store.
        const stores = await manager
          .getRepository(Stores)
          .createQueryBuilder('store')
          .setLock('pessimistic_write')
          .where('store.userId = :userId', { userId: authenticatedUser.id })
          .orderBy('store.id', 'ASC')
          .getMany();
        const store = stores.find((candidate) => candidate.id === storeId);
        if (!store) {
          throw new NotFoundException(
            new StandardResponse(true, 'STORE_NOT_FOUND'),
          );
        }
        if (stores.length <= 1) {
          throw new BadRequestException(
            new StandardResponse(true, 'ONLY_STORE_CANNOT_BE_DELETED'),
          );
        }

        await this.assertStoreHasNoActiveOrders(storeId, manager);
        const openingSchedule = await manager.findOne(OpeningSchedule, {
          where: { storeId },
        });
        if (openingSchedule) {
          await manager.delete(DaySchedule, {
            openingScheduleId: openingSchedule.id,
          });
          await manager.delete(OpeningSchedule, { id: openingSchedule.id });
        }
        await manager.remove(Stores, store);
        return {
          deletedStoreId: storeId,
          nextStoreId: stores.find((candidate) => candidate.id !== storeId)?.id,
        };
      },
    );

    return new StandardResponse(false, 'STORE_DELETED_SUCCESSFULLY', result);
  }

  private async assertStoreHasNoActiveOrders(
    storeId: string,
    manager = this.storeRepository.manager,
  ) {
    const activeOrderCount = await manager.getRepository(Orders).count({
      where: {
        storeId,
        status: In([
          OrderStatus.pending,
          OrderStatus.acknoledged,
          OrderStatus.picked_up,
          OrderStatus.in_transit,
        ]),
      },
    });
    if (activeOrderCount > 0) {
      throw new BadRequestException(
        new StandardResponse(true, 'STORE_HAS_ACTIVE_ORDERS'),
      );
    }
  }

  private maskEmail(email: string) {
    const [localPart, domain] = email.split('@');
    if (!domain) return email;
    const visible = localPart.slice(0, Math.min(2, localPart.length));
    return `${visible}${'*'.repeat(Math.max(2, localPart.length - visible.length))}@${domain}`;
  }

  private markBranchPasswordStatus(store: Stores) {
    store.branchPasswordConfigured = Boolean(store.branchPasswordHash);
    delete store.branchPasswordHash;
    delete store.branchPasswordUpdatedAt;
    return store;
  }

  private async getOwnedStoreWithBranchPassword(
    storeId: string,
    userId: string,
  ) {
    return this.storeRepository
      .createQueryBuilder('store')
      .addSelect('store.branchPasswordHash')
      .addSelect('store.branchPasswordUpdatedAt')
      .leftJoinAndSelect('store.address', 'address')
      .where('store.id = :storeId', { storeId })
      .andWhere('store.userId = :userId', { userId })
      .getOne();
  }

  async configureStorePassword(
    storeId: string,
    dto: ConfigureStorePasswordDto,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const owner = await this.usersRepository.findOne({
      where: { id: authenticatedUser.id },
    });
    const accountPasswordMatches = await bcrypt.compare(
      dto.accountPassword,
      owner?.password || '',
    );
    if (!accountPasswordMatches) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'INCORRECT_ACCOUNT_PASSWORD'),
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.storeRepository.manager.transaction(async (manager) => {
      const store = await manager
        .getRepository(Stores)
        .createQueryBuilder('store')
        .addSelect('store.branchPasswordHash')
        .setLock('pessimistic_write')
        .where('store.id = :storeId', { storeId })
        .andWhere('store.userId = :userId', { userId: authenticatedUser.id })
        .getOne();
      if (!store) {
        throw new NotFoundException(
          new StandardResponse(true, 'STORE_NOT_FOUND'),
        );
      }
      if (store.branchPasswordHash) {
        throw new BadRequestException(
          new StandardResponse(true, 'STORE_PASSWORD_ALREADY_CONFIGURED'),
        );
      }
      await manager.update(
        Stores,
        { id: storeId, userId: authenticatedUser.id },
        {
          branchPasswordHash: passwordHash,
          branchPasswordUpdatedAt: new Date(),
        },
      );
    });

    return new StandardResponse(false, 'STORE_PASSWORD_CONFIGURED');
  }

  async requestStorePasswordResetOtp(
    storeId: string,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const store = await this.storeRepository.findOne({
      where: { id: storeId, userId: authenticatedUser.id },
    });
    if (!store) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }
    if (!authenticatedUser.email) {
      throw new BadRequestException(
        new StandardResponse(true, 'ACCOUNT_EMAIL_NOT_FOUND'),
      );
    }

    await this.userOtpService.sendOTP(
      OtpType.EMAIL,
      authenticatedUser.email,
      OtpPurpose.STORE_PASSWORD_RESET,
      authenticatedUser.id,
      storeId,
    );
    return new StandardResponse(false, 'STORE_PASSWORD_RESET_OTP_SENT', {
      email: this.maskEmail(authenticatedUser.email),
    });
  }

  async resetStorePassword(
    storeId: string,
    dto: ResetStorePasswordDto,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const store = await this.storeRepository.findOne({
      where: { id: storeId, userId: authenticatedUser.id },
    });
    if (!store) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }
    if (!authenticatedUser.email) {
      throw new BadRequestException(
        new StandardResponse(true, 'ACCOUNT_EMAIL_NOT_FOUND'),
      );
    }
    await this.userOtpService.verifyOTP(
      dto.otp,
      authenticatedUser.email,
      authenticatedUser.id,
      OtpType.EMAIL,
      true,
      OtpPurpose.STORE_PASSWORD_RESET,
      storeId,
    );
    const branchPasswordHash = await bcrypt.hash(dto.password, 10);
    const result = await this.storeRepository.update(
      { id: storeId, userId: authenticatedUser.id },
      { branchPasswordHash, branchPasswordUpdatedAt: new Date() },
    );
    if (result.affected !== 1) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }
    return new StandardResponse(false, 'STORE_PASSWORD_RESET_SUCCESSFULLY');
  }

  async switchStore(
    storeId: string,
    password: string,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();

    if (!password?.trim()) {
      throw new BadRequestException(
        new StandardResponse(true, 'PASSWORD_REQUIRED'),
      );
    }

    const store = await this.getOwnedStoreWithBranchPassword(
      storeId,
      authenticatedUser.id,
    );

    if (!store) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }

    if (!store.branchPasswordHash) {
      throw new BadRequestException(
        new StandardResponse(true, 'STORE_PASSWORD_NOT_CONFIGURED'),
      );
    }
    const isPasswordValid = await bcrypt.compare(
      password,
      store.branchPasswordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException(
        new StandardResponse(true, 'INCORRECT_PASSWORD'),
      );
    }

    const storeCount = await this.storeRepository.count({
      where: { userId: authenticatedUser.id },
    });
    this.markBranchPasswordStatus(store);
    const [storeWithAvailability] = await this.attachOpeningSchedules([store]);

    return new StandardResponse(false, 'STORE_SWITCHED_SUCCESSFULLY', {
      store: storeWithAvailability,
      hasMultipleStores: storeCount > 1,
    });
  }

  async getStoreById(id: string): Promise<Stores> {
    const store = await this.storeRepository.findOne({
      where: { id },
      relations: ['address', 'user'],
    });

    if (!store) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }

    const [storeWithAvailability] = await this.attachOpeningSchedules([store]);
    return storeWithAvailability;
  }

  async getPublicStoreById(id: string): Promise<Stores> {
    const store = await this.storeRepository
      .createQueryBuilder('store')
      .leftJoinAndSelect('store.address', 'address')
      // Join only for eligibility; do not select the vendor entity into this
      // public response because it contains private account fields.
      .innerJoin('store.user', 'vendor')
      .where('store.id = :id', { id })
      .andWhere('store.isSuspended = :isSuspended', { isSuspended: false })
      .andWhere('vendor.verificationStatus = :approvedStatus', {
        approvedStatus: UserCredentialStatus.APPROVED,
      })
      .getOne();

    if (!store) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }

    const [storeWithAvailability] = await this.attachOpeningSchedules([store]);
    return storeWithAvailability;
  }

  async adminGetStores(category?: StoreCategory) {
    const storeQuery = this.storeRepository
      .createQueryBuilder('store')
      .leftJoinAndSelect('store.address', 'address')
      .leftJoinAndSelect('store.user', 'user')
      .leftJoinAndSelect('user.wallet', 'wallet')
      //.innerJoin('user.credentials', 'credentials')
      .loadRelationCountAndMap('store.ordersCount', 'store.orders')
      .innerJoin('store.menuItems', 'menuItem')
      .andWhere("store.name IS NOT NULL AND store.name != ''")
      .andWhere("store.coverImage IS NOT NULL AND store.coverImage != ''")
      .andWhere('store.addressId IS NOT NULL')
      //.andWhere('credentials.status = :credStatus', { credStatus: UserCredentialStatus.APPROVED })
      .andWhere('store.isSuspended = :isSuspended', { isSuspended: false });

    if (category) {
      storeQuery.andWhere('store.category = :category', { category });
    }

    storeQuery.groupBy('store.id, address.id, user.id, wallet.id');

    const stores = await this.attachOpeningSchedules(
      await storeQuery.getMany(),
    );

    return new StandardResponse(
      false,
      'STORES_FETCHED_SUCCESSFULLY',
      new StoreMapper().mapStoresToStoreList(stores),
    );
  }

  async setFeaturedStore(
    storeId: string,
    isFeatured: boolean,
  ): Promise<StandardResponse> {
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      relations: ['address', 'user'],
    });

    if (!store) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }

    const isKycApproved =
      store.user?.verificationStatus === UserCredentialStatus.APPROVED;

    if (isFeatured && (!isKycApproved || store.isSuspended)) {
      throw new BadRequestException(
        new StandardResponse(
          true,
          'STORE_MUST_BE_VERIFIED_AND_ACTIVE_TO_FEATURE',
        ),
      );
    }

    if (isFeatured) {
      // Repair only legacy denormalized flags after confirming the explicit
      // KYC status. Re-read below so a concurrent rejection cannot feature the
      // store using this earlier snapshot.
      if (!store.isVerified) {
        await this.storeRepository.update(
          { id: storeId, isSuspended: false },
          { isVerified: true },
        );
      }

      const currentStore = await this.storeRepository.findOne({
        where: { id: storeId },
        relations: ['user'],
      });
      const isStillEligible =
        currentStore?.user?.verificationStatus ===
          UserCredentialStatus.APPROVED && !currentStore.isSuspended;

      if (!isStillEligible) {
        await this.storeRepository.update(
          { id: storeId },
          { isVerified: false, isFeatured: false, featuredAt: null },
        );
        throw new BadRequestException(
          new StandardResponse(
            true,
            'STORE_MUST_BE_VERIFIED_AND_ACTIVE_TO_FEATURE',
          ),
        );
      }

      // Update only the Featured columns and re-check eligibility in SQL. This
      // prevents a stale entity save from undoing a concurrent suspension.
      await this.storeRepository.update(
        {
          id: storeId,
          isVerified: true,
          isSuspended: false,
          isFeatured: false,
        },
        {
          isFeatured: true,
          featuredAt: new Date(),
        },
      );
    } else {
      // Always issue the small atomic update so a concurrent Feature request
      // follows database execution order instead of an earlier stale read.
      await this.storeRepository.update(
        { id: storeId },
        {
          isFeatured: false,
          featuredAt: null,
        },
      );
    }

    const updatedStore = await this.storeRepository.findOne({
      where: { id: storeId },
      relations: ['address', 'user'],
    });

    if (!updatedStore) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }

    if (
      isFeatured &&
      (updatedStore.user?.verificationStatus !==
        UserCredentialStatus.APPROVED ||
        !updatedStore.isVerified ||
        updatedStore.isSuspended ||
        !updatedStore.isFeatured)
    ) {
      throw new BadRequestException(
        new StandardResponse(
          true,
          'STORE_MUST_BE_VERIFIED_AND_ACTIVE_TO_FEATURE',
        ),
      );
    }

    return new StandardResponse(
      false,
      isFeatured
        ? 'STORE_FEATURED_SUCCESSFULLY'
        : 'STORE_REMOVED_FROM_FEATURED_SUCCESSFULLY',
      updatedStore,
    );
  }

  async getStores(category?: StoreCategory, accessKey?: string) {
    const loggedInUser = await this.validateAccessKey(accessKey);
    if (!loggedInUser) {
      const popularStores = await this.findAllStores(category);

      return new StandardResponse(
        false,
        'POPULAR_RESTAURANTS_SELECT_LOCATION_FOR_DELIVERY',
        this.mapCustomerStores(popularStores, false),
      );
    }

    const userLocation = loggedInUser.location;

    let stores = [];
    let message = 'STORES_FETCHED_SUCCESSFULLY';
    let isError = false;

    if (!userLocation) {
      stores = await this.findAllStores(category);
      message = 'POPULAR_RESTAURANTS_SELECT_LOCATION_FOR_DELIVERY';
      return new StandardResponse(
        false,
        message,
        this.mapCustomerStores(stores, false),
      );
    }

    // New locations persist Google's canonical city key. Historical rows fall
    // back to parsing until they are naturally replaced or backfilled.
    const structuredCity = userLocation.city?.trim().toLowerCase();
    const detectedCity =
      structuredCity ||
      (await this.extractCityFromAddress(userLocation.address));

    if (detectedCity) {
      stores = await this.findStoresByCity(detectedCity, category);

      if (stores.length > 0) {
        message = `STORES_IN_${detectedCity.toUpperCase().replace(/\s+/g, '_')}`;
        const mappedStores = this.mapCustomerStores(stores, true);
        return new StandardResponse(false, message, mappedStores);
      }

      // A structured city is authoritative. Do not silently broaden an empty
      // city to the whole state (for example Minna to Suleja) because those
      // merchants may be outside the delivery area.
      if (structuredCity) {
        return new StandardResponse(
          true,
          `WE_HAVE_NOT_LAUNCHED_IN_${structuredCity
            .toUpperCase()
            .replace(/\s+/g, '_')}_YET`,
          [],
        );
      }
    }

    // Fallback to state if no city stores found
    if (userLocation.state) {
      stores = await this.findStoresByState(userLocation.state, category);

      if (stores.length > 0) {
        message = `STORES_IN_${userLocation.state.toUpperCase().replace(/\s+/g, '_')}`;
      } else {
        isError = true;
        message = 'WE_HAVE_NOT_LAUNCHED_IN_YOUR_STATE_YET';
        const mappedStores = this.mapCustomerStores([], false);
        return new StandardResponse(isError, message, mappedStores);
      }
    } else {
      stores = await this.findAllStores(category);
      message = 'POPULAR_RESTAURANTS_SELECT_LOCATION_FOR_DELIVERY';
      return new StandardResponse(
        false,
        message,
        this.mapCustomerStores(stores, false),
      );
    }

    const mappedStores = this.mapCustomerStores(stores, true);
    return new StandardResponse(isError, message, mappedStores);
  }

  private mapCustomerStores(stores: Stores[], includeFeatured: boolean) {
    const mappedStores = new StoreMapper().mapStoresToStoreList(stores);

    if (!includeFeatured) {
      // Popular fallbacks can span several states, so they must never inherit
      // the location-specific Featured label.
      mappedStores.forEach((store) => {
        store.isFeatured = false;
        store.featuredAt = null;
      });
    }

    return mappedStores;
  }

  private getStateSearchAliases(state: string): string[] {
    const normalizedState = state
      .trim()
      .toLowerCase()
      .replace(/[.,]/g, ' ')
      .replace(/\s+/g, ' ');
    if (!normalizedState) return [];

    const aliasGroup = NIGERIAN_STATE_ALIAS_GROUPS.find((aliases) =>
      aliases.includes(normalizedState),
    );
    if (aliasGroup) return [...aliasGroup];

    const withoutStateSuffix = normalizedState.replace(/\s+state$/, '');
    return [...new Set([normalizedState, withoutStateSuffix])];
  }

  // City extraction methods
  private async extractCityFromAddress(
    address: string,
  ): Promise<string | null> {
    if (!address) return null;

    try {
      // Method 2: Use ngzipcode's built-in street search to validate city
      const cities = this.getAllNigerianCities();

      for (const city of cities) {
        const cityPattern = new RegExp(
          `(^|[^a-z0-9])${escapeRegex(city)}([^a-z0-9]|$)`,
          'i',
        );
        if (cityPattern.test(address)) {
          return city;
        }
      }

      // Method 3: Try to extract city from common address patterns
      return this.extractCityFromAddressPattern(address);
    } catch (error) {
      console.error('Error extracting city:', error);
      return this.extractCityFromAddressPattern(address);
    }
  }

  private extractCityFromAddressPattern(address: string): string | null {
    const parts = address.split(',').map((p) => p.trim());

    // Nigerian addresses often follow: Street, City, State pattern
    if (parts.length >= 2) {
      // Usually the second part is the city/town
      const potentialCity = parts[1];

      // Check if it's not too long (not a full sentence)
      if (potentialCity && potentialCity.length < 30) {
        return potentialCity;
      }
    }

    return null;
  }

  private getAllNigerianCities(): string[] {
    // This can be loaded from a JSON file or constant
    return [
      // Lagos State
      'Lagos',
      'Ikeja',
      'Lekki',
      'Victoria Island',
      'VI',
      'Ajah',
      'Maryland',
      'Ikorodu',
      'Epe',
      'Badagry',
      'Mushin',
      'Oshodi',
      'Surulere',
      'Yaba',
      'Gbagada',
      'Ketu',
      'Alimosho',
      'Agege',
      'Ogba',
      'Magodo',
      'Isolo',
      'Ikotun',
      'Egbeda',
      'Iju',
      'FESTAC',
      'Amuwo Odofin',
      'Apapa',
      'Ojo',
      'Iba',
      'Satellite Town',
      'Kirikiri',
      'Tin Can Island',

      // FCT/Abuja
      'Abuja',
      'Gwarinpa',
      'Wuse',
      'Wuse II',
      'Maitama',
      'Asokoro',
      'Jabi',
      'Utako',
      'Garki',
      'Gudu',
      'Durumi',
      'Kubwa',
      'Bwari',
      'Lugbe',
      'Kuje',
      'Nyanya',
      'Karu',
      'Gwagwalada',
      'Dutse',

      // Port Harcourt/Rivers
      'Port Harcourt',
      'PH',
      'Rivers',
      'Diobu',
      'GRA',
      'Trans Amadi',
      'Woji',
      'Rumuokwuta',
      'Rumuola',
      'Rumuokwurushi',
      'Elelenwo',
      'Choba',
      'Aluu',
      'Oyigbo',
      'Okrika',
      'Bonny',
      'Degema',

      // Other major cities
      'Kano',
      'Ibadan',
      'Benin City',
      'Benin',
      'Jos',
      'Ilorin',
      'Kaduna',
      'Enugu',
      'Warri',
      'Abeokuta',
      'Owerri',
      'Uyo',
      'Calabar',
      'Maiduguri',
      'Onitsha',
      'Aba',
      'Nnewi',
      'Awka',
      'Sokoto',
      'Zaria',
      'Yola',
      'Bauchi',
      'Makurdi',
      'Minna',
      'Akure',
      'Ado Ekiti',
      'Osogbo',
      'Oyo',
      'Ilesha',
      'Sagamu',
      'Ijebu Ode',
      'Ota',
      'Ifo',
      'Ilaro',
      'Ayetoro',

      // Anambra
      'Awka',
      'Onitsha',
      'Nnewi',
      'Ekwulobia',
      'Agulu',
      'Oko',
      'Umunze',
      'Ihiala',
      'Ozubulu',
      'Ukpo',
      'Abagana',
      'Ogidi',

      // Delta
      'Asaba',
      'Warri',
      'Effurun',
      'Sapele',
      'Ughelli',
      'Agbor',
      'Kwale',
      'Ozoro',
      'Udu',
      'Oleh',
      'Koko',
      'Burutu',

      // Edo
      'Ekpoma',
      'Auchi',
      'Uromi',
      'Irrua',
      'Igueben',
      'Afuze',
      'Ubiaja',
      'Sabongida Ora',
      'Igarra',
      'Igbanke',

      // Oyo
      'Ibadan',
      'Ogbomosho',
      'Oyo',
      'Iseyin',
      'Saki',
      'Kisi',
      'Igboho',
      'Sepeteri',
      'Okeho',
      'Lanlate',
      'Eruwa',

      // Ogun
      'Abeokuta',
      'Ijebu Ode',
      'Sagamu',
      'Ota',
      'Ilaro',
      'Ayetoro',
      'Ijebu Igbo',
      'Iperu',
      'Ilisan',
      'Ikenne',
      'Ode Remo',

      // Kwara
      'Ilorin',
      'Offa',
      'Omu Aran',
      'Patigi',
      'Lafiagi',
      'Jebba',

      // Kano
      'Kano',
      'Wudil',
      'Rano',
      'Gaya',
      'Bichi',
      'Dawakin Tofa',

      // Kaduna
      'Kaduna',
      'Zaria',
      'Kafanchan',
      'Saminaka',
      'Birnin Gwari',

      // Plateau
      'Jos',
      'Bukuru',
      'Pankshin',
      'Shendam',
      'Langtang',

      // Borno
      'Maiduguri',
      'Biu',
      'Bama',
      'Dikwa',
      'Gwoza',

      // Yobe
      'Damaturu',
      'Potiskum',
      'Gashua',
      'Nguru',

      // Adamawa
      'Yola',
      'Jimeta',
      'Mubi',
      'Numan',
      'Ganye',

      // Taraba
      'Jalingo',
      'Wukari',
      'Bali',
      'Takum',
      'Ibi',

      // Benue
      'Makurdi',
      'Gboko',
      'Otukpo',
      'Katsina Ala',
      'Vandeikya',

      // Nasarawa
      'Lafia',
      'Keffi',
      'Nasarawa',
      'Akwanga',
      'Karu',

      // Kogi
      'Lokoja',
      'Okene',
      'Idah',
      'Kabba',
      'Ankpa',

      // Ekiti
      'Ado Ekiti',
      'Ikere Ekiti',
      'Oye Ekiti',
      'Ise Ekiti',
      'Ikare',

      // Ondo
      'Akure',
      'Ondo',
      'Owo',
      'Ikare',
      'Odigbo',

      // Osun
      'Osogbo',
      'Ife',
      'Ilesha',
      'Ede',
      'Iwo',

      // Ebonyi
      'Abakaliki',
      'Afikpo',
      'Onueke',
      'Ishieke',

      // Abia
      'Umuahia',
      'Aba',
      'Ohafia',
      'Arochukwu',
      'Bende',

      // Imo
      'Owerri',
      'Orlu',
      'Okigwe',
      'Mbaise',
      'Oguta',

      // Enugu
      'Enugu',
      'Nsukka',
      'Oji River',
      'Udi',
      'Agbani',

      // Akwa Ibom
      'Uyo',
      'Eket',
      'Ikot Ekpene',
      'Oron',
      'Abak',

      // Cross River
      'Calabar',
      'Ikom',
      'Ogoja',
      'Obudu',
      'Ugep',

      // Bayelsa
      'Yenagoa',
      'Brass',
      'Ogbia',
      'Nembe',

      // Rivers (additional)
      'Omoku',
      'Ahoada',
      'Bori',
      'Isiokpo',

      // Kebbi
      'Birnin Kebbi',
      'Argungu',
      'Yauri',
      'Zuru',

      // Sokoto
      'Sokoto',
      'Tambuwal',
      'Gwadabawa',
      'Wurno',

      // Zamfara
      'Gusau',
      'Talata Mafara',
      'Anka',
      'Kaura Namoda',

      // Katsina
      'Katsina',
      'Daura',
      'Funtua',
      'Malumfashi',

      // Jigawa
      'Dutse',
      'Hadejia',
      'Birnin Kudu',
      'Gumel',

      // Gombe
      'Gombe',
      'Kaltungo',
      'Billiri',
      'Dukku',

      // Bauchi
      'Bauchi',
      'Azare',
      'Misau',
      "Jama'are",

      // Niger
      'Minna',
      'Bida',
      'Kontagora',
      'Suleja',
      'Lapai',
    ];
  }

  private async findStoresByCity(
    city: string,
    category?: StoreCategory,
  ): Promise<Stores[]> {
    const cleanCity = city.trim().toLowerCase();
    const cityPattern = `(^|[^[:alnum:]])${escapeRegex(cleanCity)}([^[:alnum:]]|$)`;

    const queryBuilder = this.storeRepository
      .createQueryBuilder('store')
      .leftJoinAndSelect('store.address', 'address')
      .leftJoinAndSelect('store.user', 'user')
      //.innerJoin('user.credentials', 'credentials')
      .where(
        `(address.city = :cleanCity OR (address.city IS NULL AND LOWER(address.address) ~ :cityPattern))`,
        { cleanCity, cityPattern },
      );

    this.applyCustomerStoreEligibility(queryBuilder, category);

    queryBuilder
      .orderBy('store.isFeatured', 'DESC')
      .addOrderBy('store.featuredAt', 'DESC', 'NULLS LAST')
      .addOrderBy('store.name', 'ASC');
    return this.attachOpeningSchedules(await queryBuilder.getMany());
  }

  /**
   * Returns the exact merchant scope used for customer discovery. `null`
   * means the homepage's popular-store fallback is active; an empty array
   * means the selected city/state has no eligible merchants.
   */
  async getCustomerDiscoveryStoreIds(
    accessKey?: string,
  ): Promise<string[] | null> {
    const loggedInUser = await this.validateAccessKey(accessKey);
    return this.getCustomerDiscoveryStoreIdsForLocation(loggedInUser?.location);
  }

  async getCustomerDiscoveryStoreIdsForUser(
    userId: string,
  ): Promise<string[] | null> {
    return (await this.getCustomerDiscoveryScopeForUser(userId))
      .eligibleStoreIds;
  }

  async getCustomerSelectedLocationForUser(userId: string) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      relations: ['location'],
    });
    return user?.location || null;
  }

  async getCustomerDiscoveryScopeForUser(userId: string) {
    const location = await this.getCustomerSelectedLocationForUser(userId);
    return {
      eligibleStoreIds:
        await this.getCustomerDiscoveryStoreIdsForLocation(location),
      selectedLocation: location
        ? {
            city: location.city?.trim() || null,
            state: location.state?.trim() || null,
            country: location.country?.trim() || null,
            address: location.address?.trim() || null,
            latitude: location.latitude?.trim() || null,
            longitude: location.longitude?.trim() || null,
          }
        : null,
    };
  }

  /**
   * Returns only merchants in the same authoritative discovery scope used by
   * the customer homepage. A missing selected location is represented
   * explicitly instead of silently broadening results nationwide.
   */
  async getCustomerDiscoveryStoresForUser(
    userId: string,
    category?: StoreCategory,
  ) {
    const scope = await this.getCustomerDiscoveryScopeForUser(userId);
    const eligibleIds = scope.eligibleStoreIds;
    if (eligibleIds === null) {
      return {
        locationRequired: true,
        selectedLocation: scope.selectedLocation,
        stores: [],
      };
    }
    if (!eligibleIds.length) {
      return {
        locationRequired: false,
        selectedLocation: scope.selectedLocation,
        stores: [],
      };
    }

    const query = this.storeRepository
      .createQueryBuilder('store')
      .leftJoinAndSelect('store.address', 'address')
      .where('store.id IN (:...eligibleIds)', { eligibleIds });
    if (category === StoreCategory.GROCERY) {
      query.andWhere('store.category IN (:...categories)', {
        categories: [StoreCategory.GROCERY, StoreCategory.SUPER_MARKET],
      });
    } else if (category) {
      query.andWhere('store.category = :category', { category });
    }
    query
      .orderBy('store.isFeatured', 'DESC')
      .addOrderBy('store.featuredAt', 'DESC', 'NULLS LAST')
      .addOrderBy('store.name', 'ASC')
      .take(20);

    const stores = await this.attachOpeningSchedules(await query.getMany());
    return {
      locationRequired: false,
      selectedLocation: scope.selectedLocation,
      stores: this.mapCustomerStores(stores, true),
    };
  }

  private async getCustomerDiscoveryStoreIdsForLocation(
    userLocation?: Users['location'] | null,
  ): Promise<string[] | null> {
    if (!userLocation) return null;

    const structuredCity = userLocation.city?.trim().toLowerCase();
    const detectedCity =
      structuredCity ||
      (await this.extractCityFromAddress(userLocation.address));

    if (detectedCity) {
      const cityStoreIds = await this.findCustomerStoreIdsByCity(detectedCity);
      if (structuredCity || cityStoreIds.length > 0) return cityStoreIds;
    }

    if (userLocation.state) {
      return this.findCustomerStoreIdsByState(userLocation.state);
    }

    return null;
  }

  private applyCustomerStoreEligibility(
    queryBuilder: SelectQueryBuilder<Stores>,
    category?: StoreCategory,
  ) {
    queryBuilder
      .andWhere(STORE_HAS_MENU_ITEMS_SQL)
      .andWhere("store.name IS NOT NULL AND store.name != ''")
      .andWhere('store.addressId IS NOT NULL')
      // `isVerified` has historical meanings beyond KYC. The explicit user
      // credential status is the authoritative customer-discovery gate.
      .andWhere('user.verificationStatus = :approvedStatus', {
        approvedStatus: UserCredentialStatus.APPROVED,
      })
      .andWhere('store.isSuspended = :isSuspended', { isSuspended: false });

    if (category) {
      queryBuilder.andWhere('store.category = :category', { category });
    }

    return queryBuilder;
  }

  private async findCustomerStoreIdsByCity(city: string): Promise<string[]> {
    const cleanCity = city.trim().toLowerCase();
    if (!cleanCity) return [];
    const cityPattern = `(^|[^[:alnum:]])${escapeRegex(cleanCity)}([^[:alnum:]]|$)`;
    const queryBuilder = this.storeRepository
      .createQueryBuilder('store')
      .select('store.id')
      .innerJoin('store.address', 'address')
      .innerJoin('store.user', 'user')
      .where(
        `(address.city = :cleanCity OR (address.city IS NULL AND LOWER(address.address) ~ :cityPattern))`,
        { cleanCity, cityPattern },
      );

    this.applyCustomerStoreEligibility(queryBuilder);
    const stores = await queryBuilder.getMany();
    return stores.map((store) => store.id);
  }

  private async findCustomerStoreIdsByState(state: string): Promise<string[]> {
    const stateAliases = this.getStateSearchAliases(state);
    if (stateAliases.length === 0) return [];
    const statePattern = `(^|[^[:alnum:]])(${stateAliases
      .map(escapeRegex)
      .join('|')})([^[:alnum:]]|$)`;
    const queryBuilder = this.storeRepository
      .createQueryBuilder('store')
      .select('store.id')
      .innerJoin('store.address', 'address')
      .innerJoin('store.user', 'user')
      .where(
        `(LOWER(TRIM(address.state)) IN (:...stateAliases) OR LOWER(address.address) ~ :statePattern)`,
        { stateAliases, statePattern },
      );

    this.applyCustomerStoreEligibility(queryBuilder);
    const stores = await queryBuilder.getMany();
    return stores.map((store) => store.id);
  }
  private async validateAccessKey(accessKey?: string) {
    if (!accessKey || !accessKey.startsWith('Bearer ')) {
      return null;
    }

    try {
      const token = accessKey.split(' ')[1];

      if (!token) {
        return null;
      }

      const decoded = this.jwtService.verify(token);
      const userId = decoded.userId || decoded.sub || decoded.id;

      if (!userId) return null;

      return await this.usersRepository.findOne({
        where: { id: userId },
        relations: ['location'],
      });
    } catch (error: any) {
      console.log('Token validation failed:', error.message);
      return null;
    }
  }

  private async findStoresByState(state: string, category?: StoreCategory) {
    const stateAliases = this.getStateSearchAliases(state);
    if (stateAliases.length === 0) return [];
    const statePattern = `(^|[^[:alnum:]])(${stateAliases
      .map(escapeRegex)
      .join('|')})([^[:alnum:]]|$)`;
    const query = this.storeRepository
      .createQueryBuilder('store')
      .leftJoinAndSelect('store.address', 'address')
      .leftJoinAndSelect('store.user', 'user')
      .leftJoinAndSelect('user.wallet', 'wallet')
      //.innerJoin('user.credentials', 'credentials')
      .loadRelationCountAndMap('store.ordersCount', 'store.orders')
      .andWhere(
        `(LOWER(TRIM(address.state)) IN (:...stateAliases) OR LOWER(address.address) ~ :statePattern)`,
        { stateAliases, statePattern },
      );

    this.applyCustomerStoreEligibility(query, category);

    query
      .orderBy('store.isFeatured', 'DESC')
      .addOrderBy('store.featuredAt', 'DESC', 'NULLS LAST')
      .addOrderBy('store.name', 'ASC');
    return this.attachOpeningSchedules(await query.getMany());
  }

  private async findAllStores(category?: StoreCategory) {
    const query = this.storeRepository
      .createQueryBuilder('store')
      .leftJoinAndSelect('store.address', 'address')
      .leftJoinAndSelect('store.user', 'user')
      .leftJoinAndSelect('user.wallet', 'wallet')
      // 🌟 Join credentials and enforce the strict approved status constraint
      //.innerJoin('user.credentials', 'credentials')
      .loadRelationCountAndMap('store.ordersCount', 'store.orders');

    this.applyCustomerStoreEligibility(query, category);

    query
      .orderBy('store.isFeatured', 'DESC')
      .addOrderBy('store.featuredAt', 'DESC', 'NULLS LAST')
      .addOrderBy('store.name', 'ASC');
    return this.attachOpeningSchedules(await query.getMany());
  }

  async existingByStoreIdAndVendorId(storeId: string, vendorId: string) {
    return await this.storeRepository.exists({
      where: { id: storeId, userId: vendorId },
    });
  }

  async getStoreByMenuItem(menuItemId: string) {
    const store = await this.storeRepository.findOne({
      where: { menuItems: { id: menuItemId } },
    });

    return store;
  }

  // Toggle Free Delivery for all stores
  async setGlobalFreeDelivery(isActive: boolean) {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    let setting = await this.appSettingRepository.findOne({
      where: { key: 'global_free_delivery' },
    });
    if (!setting) {
      setting = this.appSettingRepository.create({
        key: 'global_free_delivery',
        value: isActive,
      });
    } else {
      setting.value = isActive;
      setting.createdBy =
        authenticatedUser.firstName + ' ' + authenticatedUser.lastName;
    }
    await this.appSettingRepository.save(setting);
  }

  // Check if free delivery is active for a store
  async isFreeDeliveryActive(): Promise<boolean> {
    const globalSetting = await this.appSettingRepository.findOne({
      where: { key: 'global_free_delivery' },
    });

    if (!globalSetting) return false;

    return Boolean(globalSetting.value);
  }
  async suspendStore(
    storeId: string,
    suspendDto: SuspendStoreDto,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const adminUserId = authenticatedUser.id;
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      relations: ['user'],
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    if (store.isSuspended) {
      throw new BadRequestException('Store is already suspended');
    }

    // Update suspension fields
    store.isSuspended = true;
    store.isFeatured = false;
    store.featuredAt = null;
    store.suspensionReason = suspendDto.suspensionReason;
    store.suspendedBy = adminUserId;
    store.suspendedAt = new Date();

    const updatedStore = await this.storeRepository.save(store);
    return new StandardResponse(
      false,
      'Store suspended successfully',
      updatedStore,
    );
  }

  async unsuspendStore(
    storeId: string,
    unsuspendDto?: UnsuspendStoreDto,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const adminUserId = authenticatedUser.id;
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    if (!store.isSuspended) {
      throw new BadRequestException('Store is not suspended');
    }

    // Update unsuspension fields
    store.isSuspended = false;
    store.unsuspendNotes = unsuspendDto?.unsuspendNotes;
    store.unsuspendedBy = adminUserId;
    store.unsuspendedAt = new Date();
    store.suspensionReason = null; // Clear suspension reason

    const updatedStore = await this.storeRepository.save(store);
    return new StandardResponse(
      false,
      'Store unsuspended successfully',
      updatedStore,
    );
  }

  async getSuspendedStores(
    page = 1,
    limit = 20,
    filters?: {
      startDate?: Date;
      endDate?: Date;
      search?: string;
    },
  ): Promise<StandardResponse> {
    const skip = (page - 1) * limit;
    const query = this.storeRepository
      .createQueryBuilder('store')
      .leftJoinAndSelect('store.user', 'user')
      .where('store.isSuspended = :isSuspended', { isSuspended: true })
      .orderBy('store.suspendedAt', 'DESC');

    // Apply filters
    if (filters?.startDate && filters?.endDate) {
      query.andWhere('store.suspendedAt BETWEEN :start AND :end', {
        start: filters.startDate,
        end: filters.endDate,
      });
    }

    if (filters?.search) {
      query.andWhere(
        '(store.name ILIKE :search OR store.email ILIKE :search OR user.email ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    const [stores, total] = await query
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    const storesObj = { stores, total };
    return new StandardResponse(
      false,
      'Suspended stores retrieved successfully',
      storesObj,
    );
  }
  async toggleStoreVisibility(
    storeId: string,
    isVisible: boolean,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const vendorUserId = authenticatedUser.id;
    const store = await this.storeRepository.findOne({
      where: { id: storeId, userId: vendorUserId },
    });
    if (!store) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }
    store.isVisible = isVisible;
    const updatedStore = await this.storeRepository.save(store);
    const [storeWithAvailability] = await this.attachOpeningSchedules([
      updatedStore,
    ]);
    return new StandardResponse(
      false,
      `Store visibility set to ${isVisible ? 'opened' : 'closed'} successfully`,
      storeWithAvailability,
    );
  }

  async submitSuspensionAppeal(
    storeId: string,
    appealDto: StoreAppealDto,
  ): Promise<StandardResponse> {
    const authenticatedUser = await this.commonService.getLoggedInUser();
    const store = await this.storeRepository.findOne({
      where: { id: storeId, userId: authenticatedUser.id },
      relations: ['user'],
    });

    if (!store) {
      throw new NotFoundException(
        new StandardResponse(true, 'STORE_NOT_FOUND'),
      );
    }

    if (!store.isSuspended) {
      throw new BadRequestException(
        new StandardResponse(true, 'STORE_NOT_SUSPENDED'),
      );
    }

    await this.mailSenderService.sendMail({
      recipient: 'support@cushyaccess.com',
      subject: `Merchant suspension appeal - ${store.name || store.id}`,
      template: 'merchant-suspension-appeal',
      content: {
        merchantName: `${authenticatedUser.firstName} ${authenticatedUser.lastName}`,
        merchantEmail: authenticatedUser.email,
        merchantPhone: authenticatedUser.mobile,
        storeId: store.id,
        storeName: store.name || 'Unnamed Store',
        suspensionReason: store.suspensionReason || 'No reason provided',
        appealMessage: appealDto.message,
        submittedAt: new Date().toLocaleString('en-NG', {
          timeZone: 'Africa/Lagos',
        }),
      },
    });

    return new StandardResponse(
      false,
      'SUSPENSION_APPEAL_SUBMITTED_SUCCESSFULLY',
    );
  }
}

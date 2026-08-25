import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateLocationRequest } from '../model/dto/create-location-request';
import { UserLocations } from '../model/user-locations.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { CommonService } from '../../common/common.service';
import { StandardResponse } from '../../common/module/standard-response';
import { UserMapper } from './user-mapper.service';
import { GoogleMapsService } from 'src/utils/google-maps.service';
import { GoogleLocationRequest } from '../model/dto/google-location-request';
import { Users } from '../model/users.entity';
import { UpdateVendorLocationDto } from '../model/dto/update-vendor-location.dto';

@Injectable()
export class UserLocationsService {
  private readonly logger = new Logger(UserLocationsService.name);

  constructor(
    @InjectRepository(UserLocations)
    private readonly userLocationsRepository: Repository<UserLocations>,
    @InjectRepository(Users) private readonly userRepository: Repository<Users>,
    private readonly commonsService: CommonService,
    private readonly googleMapService: GoogleMapsService,
  ) {}

  private normalizeCity(city?: string): string | undefined {
    const normalized = city?.trim().toLowerCase().replace(/\s+/g, ' ');
    return normalized || undefined;
  }

  private isSameLocation(
    existing: UserLocations,
    candidate: UpdateVendorLocationDto,
  ): boolean {
    if (existing.placeId && candidate.placeId) {
      return existing.placeId === candidate.placeId;
    }

    const normalize = (value?: string) =>
      value?.trim().toLowerCase().replace(/\s+/g, ' ') || '';
    return (
      normalize(existing.address) === normalize(candidate.address) &&
      normalize(existing.country) === normalize(candidate.country)
    );
  }

  async createLocation(createLocationRequest: CreateLocationRequest) {
    const userLocations = new UserLocations();
    const adminUser = await this.commonsService.getLoggedInUser();
    userLocations.address = createLocationRequest.address;
    userLocations.landMark = createLocationRequest.landMark;
    userLocations.address = createLocationRequest.address;
    userLocations.state = createLocationRequest.state;
    userLocations.city = this.normalizeCity(createLocationRequest.city);
    userLocations.country = createLocationRequest.country;
    userLocations.latitude = createLocationRequest.latitude;
    userLocations.longitude = createLocationRequest.longitude;
    userLocations.placeId = createLocationRequest.placeId;
    userLocations.isSupported = createLocationRequest.isSupported;
    userLocations.addedBy = adminUser.id;

    await this.userLocationsRepository.save(userLocations);

    return new StandardResponse(
      false,
      'LOCATION_CREATED_SUCCESSFULLY',
      new UserMapper().mapUserLocationsToDto(userLocations),
    );
  }

  async updateLocation(
    id: string,
    updateLocationRequest: CreateLocationRequest,
  ) {
    const userLocations = await this.getLocationById(id);
    userLocations.address = updateLocationRequest.address;
    userLocations.landMark = updateLocationRequest.landMark;
    userLocations.state = updateLocationRequest.state;
    userLocations.city = this.normalizeCity(updateLocationRequest.city);
    userLocations.country = updateLocationRequest.country;
    userLocations.latitude = updateLocationRequest.latitude;
    userLocations.longitude = updateLocationRequest.longitude;
    userLocations.placeId = updateLocationRequest.placeId;
    userLocations.isSupported = updateLocationRequest.isSupported;

    await this.userLocationsRepository.save(userLocations);

    return new StandardResponse(
      false,
      'LOCATION_UPDATED_SUCCESSFULLY',
      new UserMapper().mapUserLocationsToDto(userLocations),
    );
  }

  async getLocations(query: string) {
    const locations = await this.userLocationsRepository.find({
      where: [
        { landMark: ILike(`%${query}%`) },
        { address: ILike(`%${query}%`) },
        { state: ILike(`%${query}%`) },
        { city: ILike(`%${query}%`) },
        { country: ILike(`%${query}%`) },
      ],
    });

    return new StandardResponse(
      false,
      'LOCATIONS_FETCHED_SUCCESSFULLY',
      new UserMapper().mapUserLocationsListToDto(locations),
    );
  }

  async deleteLocation(id: string) {
    const userLocations = await this.getLocationById(id);
    await this.userLocationsRepository.remove(userLocations);

    return new StandardResponse(
      false,
      'LOCATION_DELETED_SUCCESSFULLY',
      new UserMapper().mapUserLocationsToDto(userLocations),
    );
  }

  async getLocationById(id: string): Promise<UserLocations> {
    const userLocations = await this.userLocationsRepository.findOne({
      where: {
        id,
      },
    });
    if (!userLocations) {
      throw new NotFoundException(
        new StandardResponse(true, 'LOCATION_NOT_FOUND'),
      );
    }

    return userLocations;
  }

  //Switching To Google Map

  async autoUpdateUserLocation(payload: GoogleLocationRequest) {
    const user = await this.commonsService.getLoggedInUser();
    const getAddress = await this.googleMapService.getLocationDetails(
      payload.latitude,
      payload.longitude,
    );
    const userLocations = new UserLocations();
    userLocations.address = getAddress.address;
    userLocations.landMark = getAddress.landmark;
    userLocations.state = getAddress.state;
    userLocations.city = this.normalizeCity(getAddress.city);
    userLocations.country = getAddress.country;
    userLocations.latitude = payload.latitude;
    userLocations.longitude = payload.longitude;
    userLocations.addedBy = user.id;

    await this.userLocationsRepository.save(userLocations);
    user.location = userLocations;
    user.locationId = userLocations.id;
    await this.userRepository.save(user);

    return new StandardResponse(
      false,
      'GOOGLE_MAP_LOCATION_UPDATED_SUCCESSFULLY',
      new UserMapper().mapUserLocationsToDto(userLocations),
    );
  }
  async testGoogleMap(payload: GoogleLocationRequest) {
    const getAddress = await this.googleMapService.getLocationDetails(
      payload.latitude,
      payload.longitude,
    );
    return new StandardResponse(
      false,
      'GOOGLE_MAP_LOCATION_FETCHED_SUCCESSFULLY',
      getAddress,
    );
  }
  private inferCity(address?: string): string | undefined {
    const parts = address
      ?.split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    return parts && parts.length >= 2 ? parts[parts.length - 2] : undefined;
  }

  private async resolveLocation(payload: UpdateVendorLocationDto) {
    if (payload.placeId) {
      try {
        const place = await this.googleMapService.getPlaceDetails(
          payload.placeId,
        );
        return {
          address: place.address || payload.address,
          state: place.state || payload.state,
          country: place.country || payload.country,
          city: this.normalizeCity(
            place.city || payload.city || this.inferCity(payload.address),
          ),
          latitude: place.latitude || payload.latitude,
          longitude: place.longitude || payload.longitude,
          placeId: payload.placeId,
        };
      } catch (error: any) {
        // Do not make location selection unavailable when the optional Google
        // enrichment API is temporarily unavailable. The formatted address
        // remains compatible with the historical city fallback.
        this.logger.warn(
          `Place details lookup failed; using address fallback: ${error?.message || 'unknown error'}`,
        );
      }
    }

    return {
      ...payload,
      city: this.normalizeCity(payload.city || this.inferCity(payload.address)),
    };
  }

  private async saveAndActivateLocation(
    user: Users,
    payload: UpdateVendorLocationDto,
  ) {
    const resolved = await this.resolveLocation(payload);
    return this.userLocationsRepository.manager.transaction(async (manager) => {
      const locationRepository = manager.getRepository(UserLocations);
      const usersRepository = manager.getRepository(Users);
      // Serialize location changes for this account. This makes repeated
      // requests idempotent and gives different concurrent selections a clear
      // last-committed-wins order.
      const currentUser = await usersRepository.findOne({
        where: { id: user.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!currentUser) {
        throw new NotFoundException(
          new StandardResponse(true, 'USER_NOT_FOUND'),
        );
      }

      if (currentUser.locationId) {
        const currentLocation = await locationRepository.findOne({
          where: { id: currentUser.locationId },
        });
        if (currentLocation && this.isSameLocation(currentLocation, resolved)) {
          user.location = currentLocation;
          user.locationId = currentLocation.id;
          return currentLocation;
        }
      }

      const userLocations = locationRepository.create({
        ...resolved,
        addedBy: user.id,
      });

      await locationRepository.save(userLocations);
      await usersRepository.update(user.id, {
        locationId: userLocations.id,
      });

      // Keep the request-scoped object coherent without saving its potentially
      // stale profile fields over concurrent profile updates.
      user.location = userLocations;
      user.locationId = userLocations.id;
      return userLocations;
    });
  }

  async updateVendorLocation(payload: UpdateVendorLocationDto) {
    const user = await this.commonsService.getLoggedInUser();
    const userLocations = await this.saveAndActivateLocation(user, payload);
    return new StandardResponse(
      false,
      'VENDOR_LOCATION_UPDATED_SUCCESSFULLY',
      new UserMapper().mapUserLocationsToDto(userLocations),
    );
  }
  async updateUserLocation(payload: UpdateVendorLocationDto) {
    const user = await this.commonsService.getLoggedInUser();
    const userLocations = await this.saveAndActivateLocation(user, payload);
    return new StandardResponse(
      false,
      'USER_LOCATION_UPDATED_SUCCESSFULLY',
      new UserMapper().mapUserLocationsToDto(userLocations),
    );
  }

  async batchNormalizeHistoricalStates(): Promise<StandardResponse> {
    // Assuming 'UserLocation' is your TypeORM target entity
    const locations = await this.userLocationsRepository.find();
    let updatedCount = 0;

    for (const loc of locations) {
      if (!loc.state) continue;

      const cleanState = loc.state.trim().toLowerCase();
      let targetState = loc.state;

      if (cleanState === 'minna') {
        targetState = 'Niger';
      } else if (
        ['abuja', 'fct abuja', 'federal capital territory'].includes(cleanState)
      ) {
        targetState = 'FCT';
      } else if (['ikeja', 'lagos island'].includes(cleanState)) {
        targetState = 'Lagos';
      } else if (['port harcourt', 'ph'].includes(cleanState)) {
        targetState = 'Rivers';
      } else {
        // Default auto-capitalize strategy for standard states
        targetState = loc.state
          .trim()
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
      }

      if (loc.state !== targetState) {
        loc.state = targetState;
        await this.userLocationsRepository.save(loc);
        updatedCount++;
      }
    }

    return new StandardResponse(
      false,
      `${updatedCount} historical records repaired successfully.`,
    );
  }
}

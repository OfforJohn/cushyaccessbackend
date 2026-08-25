import { UserLocations } from '../model/user-locations.entity';
import { Users } from '../model/users.entity';
import { UserLocationsService } from './user-locations.service';

describe('UserLocationsService structured locations', () => {
  it('persists the selected Google place as a normalized city location', async () => {
    const user = { id: 'user-1' } as any;
    const service = Object.create(UserLocationsService.prototype) as any;
    service.commonsService = {
      getLoggedInUser: jest.fn().mockResolvedValue(user),
    };
    service.googleMapService = {
      getPlaceDetails: jest.fn().mockResolvedValue({
        address: 'Bosso Road, Minna, Niger, Nigeria',
        city: 'Minna',
        state: 'Niger',
        country: 'Nigeria',
        latitude: '9.6139',
        longitude: '6.5569',
        placeId: 'place-minna',
      }),
    };
    const locationRepository = {
      create: jest.fn((location) => ({ id: 'ul-1', ...location })),
      save: jest.fn().mockImplementation(async (location) => location),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const usersRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'user-1', locationId: null }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service.userLocationsRepository = {
      manager: {
        transaction: jest.fn(async (operation) =>
          operation({
            getRepository: (entity) => {
              if (entity === UserLocations) return locationRepository;
              if (entity === Users) return usersRepository;
              throw new Error('Unexpected repository');
            },
          }),
        ),
      },
    };

    const response = await service.updateUserLocation({
      address: 'Bosso, Minna, Nigeria',
      state: 'Minna',
      country: 'Nigeria',
      placeId: 'place-minna',
    });

    expect(locationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        address: 'Bosso Road, Minna, Niger, Nigeria',
        city: 'minna',
        state: 'Niger',
        latitude: '9.6139',
        longitude: '6.5569',
        placeId: 'place-minna',
      }),
    );
    expect(usersRepository.update).toHaveBeenCalledWith('user-1', {
      locationId: 'ul-1',
    });
    expect(user.locationId).toBe('ul-1');
    expect(response.toJSON()).toMatchObject({
      error: false,
      message: 'USER_LOCATION_UPDATED_SUCCESSFULLY',
    });

    const existingLocation = {
      id: 'ul-existing',
      address: 'Bosso Road, Minna, Niger, Nigeria',
      country: 'Nigeria',
      placeId: 'place-minna',
    };
    usersRepository.findOne.mockResolvedValue({
      id: 'user-1',
      locationId: 'ul-existing',
    });
    locationRepository.findOne.mockResolvedValue(existingLocation);

    const duplicateResponse = await service.updateUserLocation({
      address: 'Bosso, Minna, Nigeria',
      state: 'Minna',
      country: 'Nigeria',
      placeId: 'place-minna',
    });

    expect(locationRepository.create).toHaveBeenCalledTimes(1);
    expect(usersRepository.update).toHaveBeenCalledTimes(1);
    expect(duplicateResponse.toJSON().data.id).toBe('ul-existing');
  });

  it('derives a stable city key for legacy clients without a place ID', async () => {
    const service = Object.create(UserLocationsService.prototype) as any;

    await expect(
      service.resolveLocation({
        address: 'Infant Jesus Road, Asaba, Nigeria',
        state: 'Asaba',
        country: 'Nigeria',
      }),
    ).resolves.toMatchObject({ city: 'asaba' });
  });

  it('falls back safely when Google place enrichment is unavailable', async () => {
    const service = Object.create(UserLocationsService.prototype) as any;
    service.googleMapService = {
      getPlaceDetails: jest.fn().mockRejectedValue(new Error('quota exceeded')),
    };
    service.logger = { warn: jest.fn() };

    await expect(
      service.resolveLocation({
        address: 'Bosso Road, Minna, Nigeria',
        state: 'Minna',
        country: 'Nigeria',
        placeId: 'place-minna',
      }),
    ).resolves.toMatchObject({
      address: 'Bosso Road, Minna, Nigeria',
      city: 'minna',
      placeId: 'place-minna',
    });
    expect(service.logger.warn).toHaveBeenCalledTimes(1);
  });
});

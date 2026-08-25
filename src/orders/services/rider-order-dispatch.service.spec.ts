import { RiderGateway } from '../../riders/gateways/rider.gateway';
import { RiderService } from '../../riders/services/riders.service';
import { RedisCacheService } from '../../redis-cache/redis-cache.service';
import { Orders } from '../model/order.entity';
import { RiderOrderDispatchService } from './rider-order-dispatch.service';
import { GoogleMapsService } from '../../utils/google-maps.service';
import { FCMTokenService } from '../../users/services/fcm-token.service';

describe('RiderOrderDispatchService', () => {
  const riderService = {
    findNearbyRiders: jest.fn(),
  } as unknown as RiderService;
  const gateway = {
    mapOrderResponsePublic: jest.fn(),
    notifyNewOrder: jest.fn(),
  } as unknown as RiderGateway;
  const fcmTokenService = {
    sendPushNotification: jest.fn(),
  } as unknown as FCMTokenService;
  const redisCache = {
    getCachedItem: jest.fn(),
    setItemInCache: jest.fn(),
  } as unknown as RedisCacheService;
  const googleMapsService = {
    geocodeAddress: jest.fn(),
  } as unknown as GoogleMapsService;
  const userLocationsRepository = {
    update: jest.fn(),
  };
  const service = new RiderOrderDispatchService(
    riderService,
    gateway,
    fcmTokenService,
    redisCache,
    googleMapsService,
    userLocationsRepository as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (redisCache.getCachedItem as jest.Mock).mockResolvedValue(undefined);
    (redisCache.setItemInCache as jest.Mock).mockResolvedValue(undefined);
    (userLocationsRepository.update as jest.Mock).mockResolvedValue({
      affected: 1,
    });
  });

  it('does not broadcast an order whose pickup has no usable coordinates', async () => {
    const count = await service.dispatch({ id: 'ord_missing' } as Orders);

    expect(count).toBe(0);
    expect(riderService.findNearbyRiders).not.toHaveBeenCalled();
    expect(gateway.notifyNewOrder).not.toHaveBeenCalled();
    expect(fcmTokenService.sendPushNotification).not.toHaveBeenCalled();
  });

  it('does not coerce null pickup coordinates to zero', async () => {
    const count = await service.dispatch({
      id: 'ord_null_coordinates',
      pickUpLocation: { latitude: null, longitude: null },
    } as unknown as Orders);

    expect(count).toBe(0);
    expect(riderService.findNearbyRiders).not.toHaveBeenCalled();
  });

  it('recovers and persists missing legacy pickup coordinates before dispatch', async () => {
    const order = {
      id: 'ord_legacy_location',
      pickUpLocationId: 'location_1',
      pickUpLocation: {
        address: 'Chicken Republic, Karu, Nigeria',
        latitude: null,
        longitude: null,
      },
    } as unknown as Orders;
    (googleMapsService.geocodeAddress as jest.Mock).mockResolvedValue({
      latitude: '9.0153312',
      longitude: '7.568101',
      placeId: 'place_1',
    });
    (riderService.findNearbyRiders as jest.Mock).mockResolvedValue([]);

    await expect(service.dispatch(order)).resolves.toBe(0);

    expect(userLocationsRepository.update).toHaveBeenCalledWith(
      { id: 'location_1' },
      expect.objectContaining({
        latitude: '9.0153312',
        longitude: '7.568101',
      }),
    );
    expect(riderService.findNearbyRiders).toHaveBeenCalledWith(
      9.0153312,
      7.568101,
      18,
      30,
      5,
    );
  });

  it.each([
    { latitude: 91, longitude: 6.55 },
    { latitude: 9.61, longitude: -181 },
  ])('rejects out-of-range pickup coordinates: %p', async (coordinates) => {
    const count = await service.dispatch({
      id: 'ord_invalid',
      pickUpLocation: coordinates,
    } as unknown as Orders);

    expect(count).toBe(0);
    expect(riderService.findNearbyRiders).not.toHaveBeenCalled();
  });

  it('targets only the nearby eligible riders returned by the spatial query', async () => {
    const order = {
      id: 'ord_1',
      noteForRider: 'Please call me when you reach the gate.',
      pickUpLocation: { latitude: 9.61, longitude: 6.55 },
    } as unknown as Orders;
    const publicPayload = { id: order.id, riderPayout: 800 };
    (riderService.findNearbyRiders as jest.Mock).mockResolvedValue([
      { userId: 'user_near_1', distance: 800 },
      { userId: 'user_near_2', distance: 2100 },
    ]);
    (gateway.mapOrderResponsePublic as jest.Mock).mockReturnValue(
      publicPayload,
    );

    await expect(service.dispatch(order)).resolves.toBe(2);

    expect(riderService.findNearbyRiders).toHaveBeenCalledWith(
      9.61,
      6.55,
      18,
      30,
      5,
    );
    expect(gateway.notifyNewOrder).toHaveBeenNthCalledWith(
      1,
      'user_near_1',
      publicPayload,
    );
    expect(gateway.notifyNewOrder).toHaveBeenNthCalledWith(
      2,
      'user_near_2',
      publicPayload,
    );
    expect(fcmTokenService.sendPushNotification).toHaveBeenCalledTimes(1);
    expect(redisCache.setItemInCache).toHaveBeenCalledTimes(2);
    expect(fcmTokenService.sendPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['user_near_1', 'user_near_2'],
        body: expect.stringContaining(
          'Please call me when you reach the gate.',
        ),
        data: expect.objectContaining({
          route: 'NEW_ORDER_AVAILABLE',
          orderId: 'ord_1',
          noteForRider: 'Please call me when you reach the gate.',
        }),
      }),
    );
  });

  it('suppresses a recently delivered offer for the same rider and order', async () => {
    const order = {
      id: 'ord_dedup',
      pickUpLocation: { latitude: 9.61, longitude: 6.55 },
    } as unknown as Orders;
    (riderService.findNearbyRiders as jest.Mock).mockResolvedValue([
      { userId: 'user_already_notified', distance: 500 },
      { userId: 'user_new', distance: 900 },
    ]);
    (redisCache.getCachedItem as jest.Mock)
      .mockResolvedValueOnce({ sentAt: Date.now() })
      .mockResolvedValueOnce(undefined);
    (gateway.mapOrderResponsePublic as jest.Mock).mockReturnValue({
      id: order.id,
    });

    await expect(service.dispatch(order)).resolves.toBe(1);

    expect(gateway.notifyNewOrder).toHaveBeenCalledTimes(1);
    expect(gateway.notifyNewOrder).toHaveBeenCalledWith(
      'user_new',
      expect.objectContaining({ id: 'ord_dedup' }),
    );
    expect(fcmTokenService.sendPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['user_new'] }),
    );
  });

  it('does not re-offer an order to a rider who declined it', async () => {
    const order = {
      id: 'ord_declined',
      pickUpLocation: { latitude: 9.61, longitude: 6.55 },
    } as unknown as Orders;
    (riderService.findNearbyRiders as jest.Mock).mockResolvedValue([
      { userId: 'user_declined', distance: 300 },
    ]);
    (redisCache.getCachedItem as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ reason: 'Too far' });
    (gateway.mapOrderResponsePublic as jest.Mock).mockReturnValue({
      id: order.id,
    });

    await expect(service.dispatch(order)).resolves.toBe(0);
    expect(gateway.notifyNewOrder).not.toHaveBeenCalled();
    expect(fcmTokenService.sendPushNotification).not.toHaveBeenCalled();
  });
});

/// <reference types="jest" />

import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderStatus } from 'src/orders/model/enum/order-status.enum';
import { OrderTracking } from 'src/orders/model/order-tracking.entity';
import { Orders } from 'src/orders/model/order.entity';
import { Rider, RiderStatus } from 'src/riders/model/rider.entity';
import { AssignRideToOrderUseCase } from './assign-ride-to-order.usecase';
import { UserLocations } from 'src/users/model/user-locations.entity';

const clearedRider = {
  id: 'rider-1',
  userId: 'user-rider-1',
  status: RiderStatus.ACTIVE,
  trainingCompleted: true,
  backgroundCheckStatus: 'approved',
  currentLatitude: 9.0153312,
  currentLongitude: 7.568101,
  lastLocationUpdate: new Date(),
};

const createUseCase = (
  rider: Partial<Rider> = clearedRider,
  order: Partial<Orders> = {
    id: 'order-1',
    status: OrderStatus.pending,
    riderId: null,
    pickUpLocationId: 'pickup-1',
  },
  activeJobExists = false,
) => {
  const manager = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === Rider) return rider;
      if (entity === Orders) return order;
      if (entity === UserLocations) {
        return { id: 'pickup-1', latitude: '9.02', longitude: '7.57' };
      }
      return null;
    }),
    exists: jest.fn().mockResolvedValue(activeJobExists),
    save: jest.fn(async (_entity, value) => value),
    create: jest.fn((_entity, value) => value),
  };
  const dataSource = {
    transaction: jest.fn((callback) => callback(manager)),
    getRepository: jest.fn(() => ({
      findOne: jest.fn().mockResolvedValue({
        ...clearedRider,
        user: {
          firstName: 'Tunde',
          lastName: 'Rider',
          mobile: '08030000000',
          callingCode: '234',
        },
      }),
    })),
  } as unknown as DataSource;
  const fcmTokenService = { sendPushNotification: jest.fn() };
  const mobileSenderService = { sendRiderAssignmentSms: jest.fn() };
  const eventBus = { publish: jest.fn() };
  return {
    useCase: new AssignRideToOrderUseCase(
      dataSource,
      fcmTokenService as never,
      mobileSenderService as never,
      eventBus as never,
    ),
    manager,
    fcmTokenService,
    mobileSenderService,
    eventBus,
  };
};

describe('AssignRideToOrderUseCase', () => {
  it('locks rider then order and persists assignment with tracking', async () => {
    const { useCase, manager, fcmTokenService, eventBus } = createUseCase();

    await useCase.execute('order-1', 'rider-1');

    expect(manager.findOne.mock.calls[0]).toEqual([
      Rider,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    ]);
    expect(manager.findOne.mock.calls[1]).toEqual([
      Orders,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    ]);
    expect(manager.save).toHaveBeenCalledWith(
      Orders,
      expect.objectContaining({
        riderId: 'rider-1',
        status: OrderStatus.acknoledged,
        isPaidOut: false,
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        oldStatus: OrderStatus.pending,
        newStatus: OrderStatus.acknoledged,
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      OrderTracking,
      expect.objectContaining({ orderStatus: OrderStatus.acknoledged }),
    );
    expect(fcmTokenService.sendPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['user-rider-1'],
        data: expect.objectContaining({
          route: 'RIDER_ORDER_ASSIGNED',
          orderId: 'order-1',
        }),
      }),
    );
  });

  it('sends operational assignment details without product descriptions', async () => {
    const { useCase, mobileSenderService, fcmTokenService } = createUseCase(
      clearedRider,
      {
        id: 'order-1',
        status: OrderStatus.pending,
        riderId: null,
        pickUpLocationId: 'pickup-1',
        noteForRider: 'Use the side entrance.',
        dropOffLocationAddress: 'Ado, Karu, Nasarawa',
        recipientInfo: {
          fullName: 'Ada Customer',
          phoneNumber: '08031112222',
          deliveryAddress: 'Flat 2, blue gate',
        } as never,
        orderItems: [
          {
            name: 'Jollof Rice',
            quantity: 2,
            description: 'Extra spicy',
          } as never,
        ],
        store: {
          name: 'Chicken Republic',
          category: 'restaurant',
          mobile: '08039990000',
          address: { address: 'New Nyanya, Nasarawa' },
          user: { callingCode: '234' },
        } as never,
      },
    );

    await useCase.execute('order-1', 'rider-1');

    expect(mobileSenderService.sendRiderAssignmentSms).toHaveBeenCalledWith(
      '08030000000',
      expect.objectContaining({
        riderNote: 'Use the side entrance.',
        customerName: 'Ada Customer',
        customerPhone: '08031112222',
        deliveryAddress: 'Flat 2, blue gate, Ado, Karu, Nasarawa',
        pickupName: 'Chicken Republic',
        pickupLocation: 'New Nyanya, Nasarawa',
        pickupPhone: '08039990000',
        pickupTypeLabel: 'Restaurant',
      }),
    );
    expect(
      mobileSenderService.sendRiderAssignmentSms.mock.calls[0][1],
    ).not.toHaveProperty('deliveryDescription');
    expect(
      fcmTokenService.sendPushNotification.mock.calls[0][0].data,
    ).not.toHaveProperty('deliveryDescription');
  });

  it('sends the assignment SMS even when the customer did not leave a rider note', async () => {
    const { useCase, mobileSenderService } = createUseCase();

    await useCase.execute('order-1', 'rider-1');

    expect(mobileSenderService.sendRiderAssignmentSms).toHaveBeenCalledWith(
      '08030000000',
      expect.objectContaining({
        riderNote: '',
      }),
    );
  });

  it('rejects a rider who has not completed clearance inside the lock', async () => {
    const { useCase, manager } = createUseCase({
      ...clearedRider,
      trainingCompleted: false,
    });

    await expect(useCase.execute('order-1', 'rider-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects an order concurrently assigned to another rider', async () => {
    const { useCase, manager } = createUseCase(clearedRider, {
      id: 'order-1',
      status: OrderStatus.pending,
      riderId: 'rider-2',
    });

    await expect(useCase.execute('order-1', 'rider-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('prevents assigning a second active job to one rider', async () => {
    const { useCase, manager } = createUseCase(clearedRider, undefined, true);

    await expect(useCase.execute('order-1', 'rider-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('prevents assigning an order outside the rider current area', async () => {
    const { useCase, manager } = createUseCase();
    manager.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Rider) return clearedRider;
      if (entity === Orders) {
        return {
          id: 'order-1',
          status: OrderStatus.pending,
          riderId: null,
          pickUpLocationId: 'pickup-1',
        };
      }
      if (entity === UserLocations) {
        return { id: 'pickup-1', latitude: '9.6139', longitude: '6.5569' };
      }
      return null;
    });

    await expect(useCase.execute('order-1', 'rider-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });
});

import { DataSource } from 'typeorm';
import { UserLocations } from '../../users/model/user-locations.entity';
import { GoogleMapsService } from '../../utils/google-maps.service';
import { Wallets } from '../../wallet/model/wallet.entity';
import { TransactionService } from '../../wallet/services/transaction.service';
import { ChargeNode } from '../model/charges/charge-node.entity';
import { OrderCharges } from '../model/charges/order-charges.entity';
import { OrderStatus } from '../model/enum/order-status.enum';
import { VehicleType } from '../model/enum/vechicle-type.enum';
import { OrderTracking } from '../model/order-tracking.entity';
import { OrderUser } from '../model/order-user.entity';
import { Orders } from '../model/order.entity';
import { OrdersService } from '../services/orders.service';
import { RiderOrderDispatchService } from '../services/rider-order-dispatch.service';
import { CreateDeliveryOrderUseCase } from './create-delivery-order.usecase';

describe('CreateDeliveryOrderUseCase', () => {
  it('atomically persists coordinates, debits the wallet, and dispatches the package', async () => {
    const wallet = { id: 'wa_1', userId: 'usr_1', walletBalance: 5000 };
    const savedEntities: unknown[] = [];
    let sequence = 0;
    const manager = {
      findOne: jest.fn().mockResolvedValue(wallet),
      create: jest.fn((_entity, value) => value),
      save: jest.fn(async (entity, value) => {
        const values = Array.isArray(value) ? value : [value];
        values.forEach((item) => {
          if (!item.id) item.id = `generated_${++sequence}`;
          if (entity === Orders && !item.createdAt) item.createdAt = new Date();
          savedEntities.push(item);
        });
        return Array.isArray(value) ? values : values[0];
      }),
    };
    const dataSource = {
      transaction: jest.fn((work) => work(manager)),
    } as unknown as DataSource;
    const orderService = {
      computeLogisticsCalculation: jest.fn().mockResolvedValue({
        duration: '15 mins',
        totalCharges: 1200,
        deliveryFee: 1000,
        chargeNodes: [
          Object.assign(new ChargeNode(), {
            name: 'deliveryFee',
            amount: 1000,
          }),
        ],
      }),
    } as unknown as OrdersService;
    const geocodeAddress = jest
      .fn()
      .mockResolvedValueOnce({
        address: 'Pickup, Abuja, Nigeria',
        country: 'Nigeria',
        state: 'FCT',
        city: 'Abuja',
        latitude: '9.0765',
        longitude: '7.3986',
        placeId: 'pickup-place',
      })
      .mockResolvedValueOnce({
        address: 'Dropoff, Abuja, Nigeria',
        country: 'Nigeria',
        state: 'FCT',
        city: 'Abuja',
        latitude: '9.08',
        longitude: '7.41',
        placeId: 'dropoff-place',
      });
    const transactionService = {
      createTransaction: jest.fn().mockResolvedValue({}),
    } as unknown as TransactionService;
    const dispatch = jest.fn().mockResolvedValue(1);
    const useCase = new CreateDeliveryOrderUseCase(
      {
        getLoggedInUser: jest.fn().mockResolvedValue({ id: 'usr_1' }),
      } as never,
      orderService,
      transactionService,
      { publish: jest.fn() } as never,
      dataSource,
      { geocodeAddress } as unknown as GoogleMapsService,
      { dispatch } as unknown as RiderOrderDispatchService,
    );

    await useCase.execute({
      pickUpLocation: 'Pickup address',
      dropOffLocation: 'Dropoff address',
      recipientInfo: {
        fullName: 'Recipient',
        phoneNumber: '08000000001',
        emailAddress: 'recipient@example.com',
      },
      senderInfo: {
        fullName: 'Sender',
        phoneNumber: '08000000002',
        emailAddress: 'sender@example.com',
      },
      vehicleType: VehicleType.bike,
      totalItems: 2,
      noteForRider: '',
      noteForVendor: '',
      items: [],
    });

    expect(manager.findOne).toHaveBeenCalledWith(Wallets, {
      where: { userId: 'usr_1' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(wallet.walletBalance).toBe(3800);
    expect(
      savedEntities.filter((entity) => entity instanceof UserLocations),
    ).toHaveLength(2);
    expect(
      savedEntities.filter((entity) => entity instanceof OrderUser),
    ).toHaveLength(2);
    expect(manager.save).toHaveBeenCalledWith(OrderCharges, expect.any(Object));
    const savedOrder = savedEntities.find(
      (entity) => entity instanceof Orders,
    ) as Orders;
    expect(savedOrder).toMatchObject({
      status: OrderStatus.pending,
      totalItems: 2,
      totalAmount: 1200,
      pickUpLocationId: expect.any(String),
      dropOffLocationId: expect.any(String),
    });
    expect(savedEntities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orderStatus: OrderStatus.acknoledged,
        }) as OrderTracking,
      ]),
    );
    expect(transactionService.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: savedOrder.id, amount: 1200 }),
      manager,
    );
    expect(dispatch).toHaveBeenCalledWith(savedOrder);
  });
});

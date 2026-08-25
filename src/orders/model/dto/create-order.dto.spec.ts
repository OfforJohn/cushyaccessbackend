import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAIOrderDto, CreateOrderDto } from './create-order.dto';
import { VehicleType } from '../enum/vechicle-type.enum';

describe('CreateOrderDto delivery-address validation', () => {
  const baseOrder = {
    pickUpLocationId: 'pickup-id',
    dropOffLocationId: 'dropoff-id',
    storeId: 'store-id',
    vechicleType: VehicleType.bike,
    fullHouseAddress: '  12 Bosso Road, Minna  ',
  };

  it('trims and accepts a complete normal-order address', async () => {
    const dto = plainToInstance(CreateOrderDto, baseOrder);

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.fullHouseAddress).toBe('12 Bosso Road, Minna');
  });

  it('requires all recipient fields when buying for a friend', async () => {
    const dto = plainToInstance(CreateOrderDto, {
      ...baseOrder,
      buyForFriend: true,
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property).sort()).toEqual([
      'friendDeliveryAddress',
      'friendName',
      'friendNumber',
    ]);
  });

  it('accepts complete buy-for-friend details', async () => {
    const dto = plainToInstance(CreateOrderDto, {
      ...baseOrder,
      buyForFriend: true,
      friendName: 'Jane Doe',
      friendNumber: '07070333178',
      friendDeliveryAddress: '4 Tunga Road, Minna',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('also enforces recipient details for AI-created friend orders', async () => {
    const dto = plainToInstance(CreateAIOrderDto, {
      storeId: 'store-id',
      vechicleType: VehicleType.bike,
      selectedItems: [{ menuItemId: 'item-id', quantity: 1 }],
      buyForFriend: true,
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property).sort()).toEqual([
      'friendDeliveryAddress',
      'friendName',
      'friendNumber',
    ]);
  });

  it.each([0, -1, 1.5, 100])(
    'rejects an invalid AI-selected quantity of %s',
    async (quantity) => {
      const dto = plainToInstance(CreateAIOrderDto, {
        storeId: 'store-id',
        vechicleType: VehicleType.bike,
        selectedItems: [{ menuItemId: 'item-id', quantity }],
      });

      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'selectedItems')).toBe(
        true,
      );
    },
  );

  it('rejects an empty AI item selection', async () => {
    const dto = plainToInstance(CreateAIOrderDto, {
      storeId: 'store-id',
      vechicleType: VehicleType.bike,
      selectedItems: [],
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'selectedItems')).toBe(
      true,
    );
  });

  it('validates nested option selections for AI-created orders', async () => {
    const dto = plainToInstance(CreateAIOrderDto, {
      storeId: 'store-id',
      vechicleType: VehicleType.bike,
      selectedItems: [
        {
          menuItemId: 'item-id',
          quantity: 1,
          selectedOptions: [{ groupId: '', choiceIds: ['choice-id', 12] }],
        },
      ],
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'selectedItems')).toBe(
      true,
    );
  });
});

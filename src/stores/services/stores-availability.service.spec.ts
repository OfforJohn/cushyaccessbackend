import { Days } from '../model/enums/days.enum';
import { Stores } from '../model/stores.entity';
import { StoreService } from './stores.service';

describe('StoreService availability', () => {
  const service = Object.create(StoreService.prototype) as StoreService;

  const createStore = (
    schedules: Array<{
      day: Days;
      openTime: string;
      closeTime: string;
      isClosed?: boolean;
    }>,
    isVisible = true,
  ) =>
    ({
      isVisible,
      isSuspended: false,
      openingSchedules: { schedules },
    }) as Stores;

  it('shows today opening time before the merchant opens', () => {
    const store = createStore([
      { day: Days.MONDAY, openTime: '8AM', closeTime: '6PM' },
    ]);

    const result = service.getStoreAvailability(
      store,
      new Date('2026-08-03T06:00:00.000Z'),
    );

    expect(result.isOrderable).toBe(false);
    expect(result.availabilityLabel).toBe('Merchant Closed • Opens 8AM');
  });

  it('skips closed days when finding the next opening', () => {
    const store = createStore([
      { day: Days.MONDAY, openTime: '8AM', closeTime: '6PM' },
      {
        day: Days.TUESDAY,
        openTime: '9AM',
        closeTime: '5PM',
        isClosed: true,
      },
      { day: Days.WEDNESDAY, openTime: '9AM', closeTime: '5PM' },
    ]);

    const result = service.getStoreAvailability(
      store,
      new Date('2026-08-03T18:00:00.000Z'),
    );

    expect(result.availabilityLabel).toBe(
      'Merchant Closed • Re-opens Wednesday by 9AM',
    );
  });

  it('preserves equal opening and closing times as a 24-hour day', () => {
    const store = createStore([
      { day: Days.MONDAY, openTime: '8AM', closeTime: '8AM' },
    ]);

    const result = service.getStoreAvailability(
      store,
      new Date('2026-08-03T02:00:00.000Z'),
    );

    expect(result.isOrderable).toBe(true);
    expect(result.availabilityLabel).toBe('Open');
  });

  it('supports schedules that close after midnight', () => {
    const store = createStore([
      { day: Days.MONDAY, openTime: '8PM', closeTime: '2AM' },
    ]);

    const result = service.getStoreAvailability(
      store,
      new Date('2026-08-04T00:00:00.000Z'),
    );

    expect(result.isOrderable).toBe(true);
    expect(result.availabilityLabel).toBe('Open');
  });

  it('shows the following scheduled opening when a merchant closes manually', () => {
    const store = createStore(
      [
        { day: Days.MONDAY, openTime: '8AM', closeTime: '6PM' },
        { day: Days.TUESDAY, openTime: '9AM', closeTime: '5PM' },
      ],
      false,
    );

    const result = service.getStoreAvailability(
      store,
      new Date('2026-08-03T09:00:00.000Z'),
    );

    expect(result.isWithinOperatingHours).toBe(true);
    expect(result.availabilityLabel).toBe(
      'Merchant Closed • Re-opens Tuesday by 9AM',
    );
  });
});

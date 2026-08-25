import { composeDeliveryAddress } from './delivery-address';

describe('composeDeliveryAddress', () => {
  it('combines house details with the selected map location', () => {
    expect(
      composeDeliveryAddress('Ado, Karu, Nasarawa', 'House 12, Unity Close'),
    ).toBe('House 12, Unity Close, Ado, Karu, Nasarawa');
  });

  it('does not duplicate an address already containing the location', () => {
    expect(
      composeDeliveryAddress(
        'Ado, Karu, Nasarawa',
        'House 12, Ado, Karu, Nasarawa',
      ),
    ).toBe('House 12, Ado, Karu, Nasarawa');
  });

  it('gracefully handles either missing component', () => {
    expect(composeDeliveryAddress('Ado, Karu', '')).toBe('Ado, Karu');
    expect(composeDeliveryAddress('', 'House 12')).toBe('House 12');
  });

  it('does not mistake a partial word for an already-included location', () => {
    expect(composeDeliveryAddress('Ado', 'Colorado Close, House 4')).toBe(
      'Colorado Close, House 4, Ado',
    );
  });
});

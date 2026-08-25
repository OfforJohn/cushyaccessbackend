/// <reference types="jest" />

import { createPayoutReference } from './payout-reference';

describe('createPayoutReference', () => {
  it.each(['payout', 'dpayout'] as const)(
    'creates a Paystack-compliant %s reference',
    (type) => {
      const reference = createPayoutReference(type);

      expect(reference.length).toBeGreaterThanOrEqual(16);
      expect(reference.length).toBeLessThanOrEqual(50);
      expect(reference).toMatch(/^[a-z0-9_-]+$/);
      expect(reference.startsWith(`${type}-`)).toBe(true);
    },
  );
});

import { shouldSynchronizeDatabase } from './database-synchronization';

describe('database synchronization policy', () => {
  it('allows only the single worker to synchronize production', () => {
    expect(shouldSynchronizeDatabase('production', 'worker')).toBe(true);
    expect(shouldSynchronizeDatabase('production', 'api')).toBe(false);
    expect(shouldSynchronizeDatabase('production', undefined)).toBe(false);
  });

  it('keeps automatic synchronization available outside production', () => {
    expect(shouldSynchronizeDatabase('development', 'api')).toBe(true);
    expect(shouldSynchronizeDatabase('test', undefined)).toBe(true);
    expect(shouldSynchronizeDatabase(undefined, undefined)).toBe(true);
  });
});

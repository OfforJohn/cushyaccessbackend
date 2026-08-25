import { ConfigService } from '@nestjs/config';
import { getAiRequestTimeoutMs } from './ai-provider.config';

describe('getAiRequestTimeoutMs', () => {
  const config = (value?: string) =>
    ({ get: jest.fn().mockReturnValue(value) }) as unknown as ConfigService;

  it('uses a safe default for missing or malformed values', () => {
    expect(getAiRequestTimeoutMs(config())).toBe(45_000);
    expect(getAiRequestTimeoutMs(config(''))).toBe(45_000);
    expect(getAiRequestTimeoutMs(config('nope'))).toBe(45_000);
  });

  it('clamps configured timeouts to the supported range', () => {
    expect(getAiRequestTimeoutMs(config('1'))).toBe(5_000);
    expect(getAiRequestTimeoutMs(config('999999'))).toBe(120_000);
    expect(getAiRequestTimeoutMs(config('30000.9'))).toBe(30_000);
  });
});

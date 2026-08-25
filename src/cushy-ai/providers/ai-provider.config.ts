import { ConfigService } from '@nestjs/config';

const DEFAULT_AI_REQUEST_TIMEOUT_MS = 45_000;
const MIN_AI_REQUEST_TIMEOUT_MS = 5_000;
const MAX_AI_REQUEST_TIMEOUT_MS = 120_000;

export function getAiRequestTimeoutMs(config: ConfigService): number {
  const raw = config.get<string>('CUSHY_AI_REQUEST_TIMEOUT_MS')?.trim();
  if (!raw) return DEFAULT_AI_REQUEST_TIMEOUT_MS;
  const configured = Number(raw);
  if (!Number.isFinite(configured)) return DEFAULT_AI_REQUEST_TIMEOUT_MS;
  return Math.min(
    MAX_AI_REQUEST_TIMEOUT_MS,
    Math.max(MIN_AI_REQUEST_TIMEOUT_MS, Math.floor(configured)),
  );
}

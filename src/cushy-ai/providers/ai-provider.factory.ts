import { ConfigService } from '@nestjs/config';
import { BedrockAiProvider } from './bedrock-ai.provider';
import { GeminiAiProvider } from './gemini-ai.provider';

export function createAiProvider(
  config: ConfigService,
  bedrock: BedrockAiProvider,
  gemini: GeminiAiProvider,
) {
  const provider = (config.get<string>('CUSHY_AI_PROVIDER') || 'bedrock')
    .trim()
    .toLowerCase();
  if (provider === 'bedrock') return bedrock;
  if (provider === 'gemini') return gemini;
  throw new Error(`Unsupported CUSHY_AI_PROVIDER "${provider}".`);
}

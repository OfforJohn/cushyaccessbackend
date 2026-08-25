import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createAiProvider } from './providers/ai-provider.factory';
import { AI_PROVIDER } from './providers/ai-provider.token';
import { BedrockAiProvider } from './providers/bedrock-ai.provider';
import { GeminiAiProvider } from './providers/gemini-ai.provider';

/**
 * Provider-neutral AI boundary shared by Cushy AI and focused AI features.
 * Business modules depend only on AI_PROVIDER, never directly on Bedrock/Gemini.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    BedrockAiProvider,
    GeminiAiProvider,
    {
      provide: AI_PROVIDER,
      inject: [ConfigService, BedrockAiProvider, GeminiAiProvider],
      useFactory: createAiProvider,
    },
  ],
  exports: [AI_PROVIDER],
})
export class CushyAiProviderModule {}

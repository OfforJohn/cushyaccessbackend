import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ContentBlock,
  Message,
  Tool,
} from '@aws-sdk/client-bedrock-runtime';
import {
  AiContentBlock,
  AiModelRequest,
  AiModelResponse,
  AiProvider,
} from '../model/ai.types';
import { getAiRequestTimeoutMs } from './ai-provider.config';

export const DEFAULT_BEDROCK_MODEL_ID = 'openai.gpt-oss-120b-1:0';

export function resolveBedrockModelId(configuredModelId?: string): string {
  const configured = configuredModelId?.trim();
  // A safeguard model classifies/moderates content; it is not the Cushy AI
  // conversational model and cannot be allowed to silently power production.
  if (!configured || /safeguard/i.test(configured)) {
    return DEFAULT_BEDROCK_MODEL_ID;
  }
  return configured;
}

@Injectable()
export class BedrockAiProvider implements AiProvider {
  readonly name = 'bedrock';
  private readonly logger = new Logger(BedrockAiProvider.name);
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.client = new BedrockRuntimeClient({
      region:
        config.get<string>('CUSHY_AI_AWS_REGION') ||
        config.get<string>('AWS_REGION') ||
        'eu-west-1',
    });
    const configuredModelId = config.get<string>('CUSHY_AI_BEDROCK_MODEL_ID');
    this.modelId = resolveBedrockModelId(configuredModelId);
    if (configuredModelId && configuredModelId !== this.modelId) {
      this.logger.error(
        `Refusing non-conversational Bedrock model ${configuredModelId}; using ${this.modelId}`,
      );
    }
    this.timeoutMs = getAiRequestTimeoutMs(config);
  }

  async generate(request: AiModelRequest): Promise<AiModelResponse> {
    const command = new ConverseCommand({
      modelId: this.modelId,
      system: [{ text: request.systemPrompt }],
      messages: request.messages.map((message) =>
        this.toBedrockMessage(message),
      ),
      toolConfig: request.tools.length
        ? {
            tools: request.tools.map(
              (tool): Tool => ({
                toolSpec: {
                  name: tool.name,
                  description: tool.description,
                  inputSchema: { json: tool.inputSchema as any },
                },
              }),
            ),
            toolChoice:
              request.toolChoice === 'required' ? { any: {} } : { auto: {} },
          }
        : undefined,
      inferenceConfig: {
        maxTokens: request.maxTokens || 1_200,
        temperature: request.temperature ?? 0.3,
      },
    });

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.client.send(command, {
        abortSignal: abortController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const blocks = response.output?.message?.content || [];
    const content = blocks
      .map((block): AiContentBlock | null => {
        if (block.text) return { type: 'text', text: block.text };
        if (block.toolUse?.toolUseId && block.toolUse.name) {
          return {
            type: 'tool_call',
            id: block.toolUse.toolUseId,
            name: block.toolUse.name,
            input: (block.toolUse.input || {}) as Record<string, unknown>,
          };
        }
        return null;
      })
      .filter((block): block is AiContentBlock => Boolean(block));

    const stopReason =
      response.stopReason === 'tool_use'
        ? 'tool_use'
        : response.stopReason === 'end_turn'
          ? 'end_turn'
          : response.stopReason === 'max_tokens'
            ? 'max_tokens'
            : 'unknown';

    this.logger.debug(
      `Bedrock response model=${this.modelId} stopReason=${response.stopReason}`,
    );
    return { content, stopReason };
  }

  private toBedrockMessage(message: {
    role: 'user' | 'assistant';
    content: AiContentBlock[];
  }): Message {
    const content = message.content.map((block): ContentBlock => {
      if (block.type === 'text') return { text: block.text };
      if (block.type === 'tool_call') {
        return {
          toolUse: {
            toolUseId: block.id,
            name: block.name,
            input: block.input as any,
          },
        };
      }
      return {
        toolResult: {
          toolUseId: block.toolCallId,
          status: block.isError ? 'error' : 'success',
          content: [{ text: block.content }],
        },
      };
    });
    return { role: message.role, content };
  }
}

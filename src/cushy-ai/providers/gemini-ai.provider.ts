import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FunctionCallingConfigMode, GoogleGenAI } from '@google/genai';
import {
  AiContentBlock,
  AiModelRequest,
  AiModelResponse,
  AiProvider,
} from '../model/ai.types';
import { getAiRequestTimeoutMs } from './ai-provider.config';

@Injectable()
export class GeminiAiProvider implements AiProvider {
  readonly name = 'gemini';
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly client?: GoogleGenAI;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('CUSHY_AI_GEMINI_API_KEY');
    this.client = this.apiKey
      ? new GoogleGenAI({ apiKey: this.apiKey })
      : undefined;
    this.model =
      config.get<string>('CUSHY_AI_GEMINI_MODEL') || 'gemini-3.5-flash';
    this.timeoutMs = getAiRequestTimeoutMs(config);
  }

  async generate(request: AiModelRequest): Promise<AiModelResponse> {
    if (!this.client) throw new Error('CUSHY_AI_GEMINI_API_KEY is required');
    const response: any = await this.client.models.generateContent({
      model: this.model,
      contents: request.messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: message.content.map((block) => {
          if (block.type === 'text') return { text: block.text };
          if (block.type === 'tool_call') {
            return { functionCall: { name: block.name, args: block.input } };
          }
          let parsed: unknown = block.content;
          try {
            parsed = JSON.parse(block.content);
          } catch {}
          const responseBody =
            parsed && typeof parsed === 'object'
              ? (parsed as Record<string, unknown>)
              : { result: parsed };
          return {
            functionResponse: {
              name: block.name || 'tool_result',
              response: responseBody,
            },
          };
        }),
      })) as any,
      config: {
        httpOptions: { timeout: this.timeoutMs },
        systemInstruction: request.systemPrompt,
        temperature: request.temperature ?? 0.3,
        maxOutputTokens: request.maxTokens || 1_200,
        tools: request.tools.length
          ? [
              {
                functionDeclarations: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                })),
              },
            ]
          : undefined,
        toolConfig: request.tools.length
          ? {
              functionCallingConfig: {
                mode:
                  request.toolChoice === 'required'
                    ? FunctionCallingConfigMode.ANY
                    : FunctionCallingConfigMode.AUTO,
              },
            }
          : undefined,
      },
    });
    const parts: any[] = response.candidates?.[0]?.content?.parts || [];
    const content = parts
      .map((part, index): AiContentBlock | null => {
        if (part.text) return { type: 'text', text: String(part.text) };
        if (part.functionCall?.name) {
          return {
            type: 'tool_call',
            id: `gemini-call-${Date.now()}-${index}`,
            name: String(part.functionCall.name),
            input: (part.functionCall.args || {}) as Record<string, unknown>,
          };
        }
        return null;
      })
      .filter((block): block is AiContentBlock => Boolean(block));
    return {
      content,
      stopReason: content.some((block) => block.type === 'tool_call')
        ? 'tool_use'
        : 'end_turn',
    };
  }
}

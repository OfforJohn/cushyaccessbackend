import { ConfigService } from '@nestjs/config';
import { BedrockAiProvider } from './bedrock-ai.provider';
import { GeminiAiProvider } from './gemini-ai.provider';

const request = {
  systemPrompt: 'Classify safely.',
  messages: [
    {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'data' }],
    },
  ],
  tools: [
    {
      name: 'submit_result',
      description: 'Submit a result.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
  toolChoice: 'required' as const,
};

describe('AI provider tool-choice translation', () => {
  it('maps required tool choice and timeout for Bedrock', async () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'CUSHY_AI_REQUEST_TIMEOUT_MS' ? '12000' : undefined,
      ),
    } as unknown as ConfigService;
    const provider = new BedrockAiProvider(config);
    const send = jest.fn().mockResolvedValue({
      stopReason: 'tool_use',
      output: { message: { content: [] } },
    });
    (provider as any).client = { send };

    await provider.generate(request);

    const command = send.mock.calls[0][0];
    expect(command.input.toolConfig.toolChoice).toEqual({ any: {} });
    expect(send.mock.calls[0][1].abortSignal).toBeDefined();
  });

  it('maps required tool choice and timeout for Gemini', async () => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'CUSHY_AI_GEMINI_API_KEY') return 'test-key';
        if (key === 'CUSHY_AI_REQUEST_TIMEOUT_MS') return '12000';
        return undefined;
      }),
    } as unknown as ConfigService;
    const provider = new GeminiAiProvider(config);
    const generateContent = jest.fn().mockResolvedValue({ candidates: [] });
    (provider as any).client = { models: { generateContent } };

    await provider.generate(request);

    const call = generateContent.mock.calls[0][0];
    expect(call.config.httpOptions.timeout).toBe(12_000);
    expect(call.config.toolConfig.functionCallingConfig.mode).toBe('ANY');
  });
});

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { AiUsageTrackingService } from './ai-usage-tracking.service';
import { ConversationService } from '../conversation.service';
import { v4 as uuidv4 } from 'uuid';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiChat } from '../model/entity/ai-chat.entity';
import { AiChatMessage, AiChatMessageRole } from '../model/entity/ai-chat-message.entity';

export interface TestAiRequest {
  provider: 'gemini' | 'bedrock';
  message: string;
  userId?: string;
  chatId?: string;
}

export interface TestAiResponse {
  success: boolean;
  provider: string;
  response?: string;
  error?: string;
  usage: {
    tokens: number;
    cost: number;
    responseTime: number;
  };
  metricId: string;
}

@Injectable()
export class AiTestingService {
  private readonly logger = new Logger(AiTestingService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly usageTrackingService: AiUsageTrackingService,
    private readonly conversationService: ConversationService,
    @InjectRepository(AiChat)
    private readonly chatRepo: Repository<AiChat>,
    @InjectRepository(AiChatMessage)
    private readonly messageRepo: Repository<AiChatMessage>,
  ) {}

  async testProvider(request: TestAiRequest): Promise<TestAiResponse> {
    const startTime = Date.now();
    let response: string;
    let tokens = 0;
    let error = null;

    try {
      let history: any[] = [];
      if (request.chatId) {
        const messages = await this.conversationService.getModelHistory(request.chatId);
        history = messages.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        }));
      }

      if (request.provider === 'gemini') {
        const result = await this.testGemini(request.message, history);
        response = result.response;
        tokens = result.tokens;
      } else if (request.provider === 'bedrock') {
        const result = await this.testBedrock(request.message, history);
        response = result.response;
        tokens = result.tokens;
      } else {
        throw new Error(`Unknown provider: ${request.provider}`);
      }

      const responseTime = Date.now() - startTime;
      const cost = this.calculateCost(request.provider, tokens);

      // Record usage metric
      const metric = await this.usageTrackingService.recordUsage({
        provider: request.provider,
        requestCount: 1,
        tokenCount: tokens,
        errorCount: 0,
        cost,
        responseTime,
        userId: request.userId,
        requestMessage: request.message,
        responseMessage: response,
        isTest: true,
      });

      return {
        success: true,
        provider: request.provider,
        response,
        usage: {
          tokens,
          cost: parseFloat(cost.toFixed(6)),
          responseTime,
        },
        metricId: metric.id,
      };
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      const responseTime = Date.now() - startTime;

      // Record error metric
      const metric = await this.usageTrackingService.recordUsage({
        provider: request.provider,
        requestCount: 1,
        tokenCount: 0,
        errorCount: 1,
        cost: 0,
        responseTime,
        userId: request.userId,
        requestMessage: request.message,
        responseMessage: null,
        isTest: true,
        metadata: { errorType: error },
      });

      this.logger.error(`AI test failed for ${request.provider}: ${error}`);

      return {
        success: false,
        provider: request.provider,
        error,
        usage: {
          tokens: 0,
          cost: 0,
          responseTime,
        },
        metricId: metric.id,
      };
    }
  }

  private async testGemini(message: string, history: any[] = []): Promise<{ response: string; tokens: number }> {
    const apiKey = this.config.get<string>('CUSHY_AI_GEMINI_API_KEY');
    const model = this.config.get<string>('CUSHY_AI_GEMINI_MODEL') || 'gemini-3.5-flash';

    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    try {
      const client = new GoogleGenAI({ apiKey });
      const contents = [...history, { role: 'user', parts: [{ text: message }] }];
      const result = await client.models.generateContent({
        model,
        contents,
      }) as any;

      const response = result.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';

      // Estimate tokens (rough estimate: 4 chars per token)
      const historyLength = history.reduce((sum, msg) => sum + JSON.stringify(msg).length, 0);
      const estimatedTokens = Math.ceil((historyLength + message.length + response.length) / 4);

      return { response, tokens: estimatedTokens };
    } catch (error) {
      throw new Error(`Gemini API call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async testBedrock(message: string, history: any[] = []): Promise<{ response: string; tokens: number }> {
    const region = this.config.get<string>('AWS_REGION') || 'eu-west-1';
    const modelId = this.config.get<string>('CUSHY_AI_BEDROCK_MODEL_ID') || 'openai.gpt-oss-120b-1:0';

    const hasCredentials = this.config.get<string>('AWS_ACCESS_KEY_ID') ||
                           this.config.get<string>('AWS_SECRET_ACCESS_KEY');

    if (!hasCredentials) {
      throw new Error('AWS credentials not configured');
    }

    try {
      const client = new BedrockRuntimeClient({ region });

      // Simple invocation (implementation depends on actual Bedrock API)
      // For now, return a mock response since we can't easily test without credits
      const historyContext = history.length > 0 ? ` (with ${history.length} previous messages)` : '';
      const response = `Bedrock response to: ${message}${historyContext} (Model: ${modelId})`;

      // Estimate tokens
      const historyLength = history.reduce((sum, msg) => sum + JSON.stringify(msg).length, 0);
      const estimatedTokens = Math.ceil((historyLength + message.length + response.length) / 4);

      return { response, tokens: estimatedTokens };
    } catch (error) {
      throw new Error(`Bedrock API call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private calculateCost(provider: string, tokens: number): number {
    if (provider === 'gemini') {
      // Gemini Flash pricing (approximate)
      const inputCostPerMillion = 0.075;
      const outputCostPerMillion = 0.3;
      
      // Assuming 50% input, 50% output tokens
      const inputTokens = tokens * 0.5;
      const outputTokens = tokens * 0.5;
      
      return (inputTokens / 1000000) * inputCostPerMillion + 
             (outputTokens / 1000000) * outputCostPerMillion;
    } else if (provider === 'bedrock') {
      // Bedrock pricing varies by model - using approximate pricing
      const costPerMillionTokens = 0.001;
      return (tokens / 1000000) * costPerMillionTokens;
    }
    
    return 0;
  }

  async createTestChat(title?: string, userId?: string) {
    const testUserId = userId || 'test-user-' + uuidv4();
    const chat = await this.chatRepo.save(
      this.chatRepo.create({
        userId: testUserId,
        title: title || 'Test chat',
        processingAt: null,
      }),
    );
    return {
      success: true,
      chatId: chat.id,
      userId: testUserId,
      title: chat.title,
    };
  }

  async addMessageToChat(chatId: string, role: 'user' | 'assistant', content: string) {
    const message = await this.messageRepo.save(
      this.messageRepo.create({
        chatId,
        role: role === 'assistant' ? AiChatMessageRole.ASSISTANT : AiChatMessageRole.USER,
        content,
      }),
    );
    await this.chatRepo.update(chatId, { updatedAt: new Date() });
    return {
      success: true,
      messageId: message.id,
    };
  }
}

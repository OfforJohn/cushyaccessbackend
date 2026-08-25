import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { CommonService } from 'src/common/common.service';
import { StandardResponse } from 'src/common/module/standard-response';
import { Conversation } from './model/entity/conversation.entity';
import { AiChat } from './model/entity/ai-chat.entity';
import {
  AiChatMessage,
  AiChatMessageRole,
} from './model/entity/ai-chat-message.entity';
import { AiComponent } from './model/ai.types';

const CHAT_PAGE_SIZE = 50;
const CHAT_MESSAGE_LIMIT = 200;
const MODEL_HISTORY_LIMIT = 30;
const MODEL_HISTORY_CHARACTER_LIMIT = 40_000;
const PROCESSING_LOCK_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation)
    private readonly legacyConversationRepo: Repository<Conversation>,
    @InjectRepository(AiChat)
    private readonly chatRepo: Repository<AiChat>,
    @InjectRepository(AiChatMessage)
    private readonly messageRepo: Repository<AiChatMessage>,
    private readonly commonService: CommonService,
  ) {}

  async createChatForUser(userId: string, title?: string): Promise<AiChat> {
    return this.chatRepo.save(
      this.chatRepo.create({
        userId,
        title: this.normalizeTitle(title || 'New conversation'),
        processingAt: null,
      }),
    );
  }

  async createChat(title?: string): Promise<StandardResponse> {
    const user = await this.commonService.getLoggedInUser();
    const chat = await this.createChatForUser(user.id, title);
    return new StandardResponse(
      false,
      'AI_CHAT_CREATED',
      this.toChatSummary(chat),
    );
  }

  async listChats(): Promise<StandardResponse> {
    const user = await this.commonService.getLoggedInUser();
    const chats = await this.chatRepo.find({
      where: { userId: user.id },
      order: { updatedAt: 'DESC' },
      take: CHAT_PAGE_SIZE,
    });
    return new StandardResponse(
      false,
      'AI_CHATS_FETCHED',
      chats.map((chat) => this.toChatSummary(chat)),
    );
  }

  async getChat(chatId: string): Promise<StandardResponse> {
    const user = await this.commonService.getLoggedInUser();
    const chat = await this.requireOwnedChat(chatId, user.id);
    const messages = await this.messageRepo.find({
      where: { chatId: chat.id },
      order: { createdAt: 'DESC' },
      take: CHAT_MESSAGE_LIMIT,
    });
    return new StandardResponse(false, 'AI_CHAT_FETCHED', {
      ...this.toChatSummary(chat),
      messages: messages.reverse().map((message) => this.toMessageDto(message)),
    });
  }

  async deleteChat(chatId: string): Promise<StandardResponse> {
    const user = await this.commonService.getLoggedInUser();
    const staleBefore = new Date(Date.now() - PROCESSING_LOCK_TTL_MS);
    const result = await this.chatRepo
      .createQueryBuilder()
      .delete()
      .from(AiChat)
      .where('"id" = :chatId', { chatId })
      .andWhere('"userId" = :userId', { userId: user.id })
      .andWhere(
        '(\"processingAt\" IS NULL OR \"processingAt\" < :staleBefore)',
        {
          staleBefore,
        },
      )
      .execute();
    if (result.affected !== 1) {
      const exists = await this.chatRepo.exists({
        where: { id: chatId, userId: user.id },
      });
      if (exists) throw new ConflictException('AI_CHAT_BUSY');
      throw new NotFoundException('AI_CHAT_NOT_FOUND');
    }
    return new StandardResponse(false, 'AI_CHAT_DELETED', { chatId });
  }

  async resolveChat(
    userId: string,
    chatId: string | undefined,
    newSession: boolean,
    firstMessage: string,
  ): Promise<AiChat> {
    if (!chatId || newSession) {
      return this.createChatForUser(userId, firstMessage);
    }
    return this.requireOwnedChat(chatId, userId);
  }

  async acquireTurn(chatId: string, userId: string): Promise<string> {
    const staleBefore = new Date(Date.now() - PROCESSING_LOCK_TTL_MS);
    const processingToken = uuidv4();
    const result = await this.chatRepo
      .createQueryBuilder()
      .update(AiChat)
      .set({ processingAt: new Date(), processingToken })
      .where('"id" = :chatId', { chatId })
      .andWhere('"userId" = :userId', { userId })
      .andWhere(
        '(\"processingAt\" IS NULL OR \"processingAt\" < :staleBefore)',
        {
          staleBefore,
        },
      )
      .execute();
    if (result.affected !== 1) {
      throw new ConflictException('AI_CHAT_BUSY');
    }
    return processingToken;
  }

  async renewTurn(
    chatId: string,
    userId: string,
    processingToken: string,
  ): Promise<void> {
    const result = await this.chatRepo.update(
      { id: chatId, userId, processingToken },
      { processingAt: new Date() },
    );
    if (result.affected !== 1) {
      throw new ConflictException('AI_CHAT_LOCK_LOST');
    }
  }

  async releaseTurn(
    chatId: string,
    userId: string,
    processingToken: string,
  ): Promise<void> {
    await this.chatRepo.update(
      { id: chatId, userId, processingToken },
      { processingAt: null, processingToken: null },
    );
  }

  async findIdempotentResponse(
    chatId: string,
    clientMessageId?: string,
  ): Promise<AiChatMessage | null> {
    if (!clientMessageId) return null;
    const userMessage = await this.messageRepo.findOne({
      where: { chatId, clientMessageId, role: AiChatMessageRole.USER },
    });
    if (!userMessage) return null;
    return this.messageRepo.findOne({
      where: {
        chatId,
        role: AiChatMessageRole.ASSISTANT,
        replyToMessageId: userMessage.id,
      },
    });
  }

  async findUserMessageByClientId(
    chatId: string,
    clientMessageId?: string,
  ): Promise<AiChatMessage | null> {
    if (!clientMessageId) return null;
    return this.messageRepo.findOne({
      where: { chatId, clientMessageId, role: AiChatMessageRole.USER },
    });
  }

  async saveUserMessage(
    chat: AiChat,
    content: string,
    clientMessageId?: string,
  ): Promise<AiChatMessage> {
    const message = await this.messageRepo.save(
      this.messageRepo.create({
        chatId: chat.id,
        role: AiChatMessageRole.USER,
        content,
        clientMessageId: clientMessageId || null,
      }),
    );
    const update: Partial<AiChat> = { updatedAt: new Date() };
    if (chat.title === 'New conversation') {
      update.title = this.normalizeTitle(content);
    }
    await this.chatRepo.update({ id: chat.id, userId: chat.userId }, update);
    return message;
  }

  async saveAssistantMessage(
    chatId: string,
    content: string,
    components: AiComponent[],
    replyToMessageId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AiChatMessage> {
    const message = await this.messageRepo.save(
      this.messageRepo.create({
        chatId,
        role: AiChatMessageRole.ASSISTANT,
        content,
        replyToMessageId,
        components: components.length ? components : null,
        metadata: metadata || null,
      }),
    );
    await this.chatRepo.update(chatId, { updatedAt: new Date() });
    return message;
  }

  async saveAssistantEvent(
    chatId: string,
    userId: string,
    eventKey: string,
    content: string,
    components: AiComponent[],
  ): Promise<AiChatMessage> {
    await this.requireOwnedChat(chatId, userId);
    const clientMessageId = `event:${eventKey}`.slice(0, 100);
    const findExisting = () =>
      this.messageRepo.findOne({ where: { chatId, clientMessageId } });
    const existing = await findExisting();
    if (existing) return existing;

    let message: AiChatMessage;
    try {
      message = await this.messageRepo.save(
        this.messageRepo.create({
          chatId,
          role: AiChatMessageRole.ASSISTANT,
          content,
          clientMessageId,
          components: components.length ? components : null,
          metadata: { eventKey },
        }),
      );
    } catch (error) {
      // Concurrent/retried action-result requests share a unique event key.
      // If another request won, return its message instead of duplicating it.
      const racedMessage = await findExisting();
      if (!racedMessage) throw error;
      message = racedMessage;
    }
    await this.chatRepo.update(
      { id: chatId, userId },
      { updatedAt: new Date() },
    );
    return message;
  }

  async getModelHistory(chatId: string): Promise<AiChatMessage[]> {
    const newestFirst = await this.messageRepo.find({
      where: { chatId },
      order: { createdAt: 'DESC' },
      take: MODEL_HISTORY_LIMIT,
    });
    const selected: AiChatMessage[] = [];
    let remainingCharacters = MODEL_HISTORY_CHARACTER_LIMIT;
    for (const message of newestFirst) {
      const length = message.content.length;
      if (length > remainingCharacters) break;
      selected.push(message);
      remainingCharacters -= length;
    }
    return selected.reverse();
  }

  toMessageDto(message: AiChatMessage) {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      components: message.components || [],
      createdAt: message.createdAt,
    };
  }

  // Kept temporarily for old app builds during the structured-chat rollout.
  async saveConversation(
    userId: string,
    userMessage: string,
    aiResponse: string,
    chatId?: string,
  ) {
    const convo = this.legacyConversationRepo.create({
      userId,
      chatId: chatId || null,
      userMessage,
      aiResponse,
    });
    return this.legacyConversationRepo.save(convo);
  }

  async getUserConversations() {
    const user = await this.commonService.getLoggedInUser();
    return new StandardResponse(
      false,
      'CONVERSATIONS_FETCHED',
      (
        await this.legacyConversationRepo.find({
          where: { userId: user.id },
          order: { createdAt: 'DESC' },
          take: CHAT_MESSAGE_LIMIT,
        })
      ).reverse(),
    );
  }

  private async requireOwnedChat(
    chatId: string,
    userId: string,
  ): Promise<AiChat> {
    const chat = await this.chatRepo.findOne({ where: { id: chatId, userId } });
    if (!chat) throw new NotFoundException('AI_CHAT_NOT_FOUND');
    return chat;
  }

  private normalizeTitle(value: string): string {
    const title = value.replace(/\s+/g, ' ').trim();
    if (!title) return 'New conversation';
    return title.length > 60 ? `${title.slice(0, 57).trim()}...` : title;
  }

  private toChatSummary(chat: AiChat) {
    return {
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    };
  }
}

import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConversationService } from './conversation.service';

describe('ConversationService chat ownership', () => {
  const legacyRepo = {};
  const executeDelete = jest.fn();
  const deleteQueryBuilder: Record<string, jest.Mock> = {
    delete: jest.fn(),
    from: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    execute: executeDelete,
  };
  Object.values(deleteQueryBuilder).forEach((mock) => {
    if (mock !== executeDelete) mock.mockReturnValue(deleteQueryBuilder);
  });
  const chatRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(deleteQueryBuilder),
    exists: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const messageRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(),
  };
  const commonService = {
    getLoggedInUser: jest.fn().mockResolvedValue({ id: 'customer_1' }),
  };
  const service = new ConversationService(
    legacyRepo as any,
    chatRepo as any,
    messageRepo as any,
    commonService as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('permanently deletes only a chat owned by the authenticated user', async () => {
    executeDelete.mockResolvedValue({ affected: 1 });

    const response = await service.deleteChat('ai-chat_1');

    expect(deleteQueryBuilder.where).toHaveBeenCalledWith('"id" = :chatId', {
      chatId: 'ai-chat_1',
    });
    expect(deleteQueryBuilder.andWhere).toHaveBeenCalledWith(
      '"userId" = :userId',
      { userId: 'customer_1' },
    );
    expect(response.toJSON().data).toEqual({ chatId: 'ai-chat_1' });
  });

  it('does not reveal whether another user chat exists', async () => {
    executeDelete.mockResolvedValue({ affected: 0 });
    chatRepo.exists.mockResolvedValue(false);

    await expect(service.deleteChat('ai-chat_other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses to delete a chat while its response is being generated', async () => {
    executeDelete.mockResolvedValue({ affected: 0 });
    chatRepo.exists.mockResolvedValue(true);

    await expect(service.deleteChat('ai-chat_1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('persists an assistant event once for an owned chat', async () => {
    chatRepo.findOne.mockResolvedValue({
      id: 'ai-chat_1',
      userId: 'customer_1',
    });
    messageRepo.findOne.mockResolvedValue(null);
    messageRepo.save.mockImplementation(async (message) => ({
      id: 'ai-msg-event',
      ...message,
    }));

    const saved = await service.saveAssistantEvent(
      'ai-chat_1',
      'customer_1',
      'order-confirmed:ord_1',
      'Order confirmed',
      [],
    );

    expect(saved.id).toBe('ai-msg-event');
    expect(messageRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMessageId: 'event:order-confirmed:ord_1',
        role: 'assistant',
      }),
    );
    expect(chatRepo.update).toHaveBeenCalledWith(
      { id: 'ai-chat_1', userId: 'customer_1' },
      { updatedAt: expect.any(Date) },
    );
  });

  it('returns the existing assistant event on a response retry', async () => {
    chatRepo.findOne.mockResolvedValue({
      id: 'ai-chat_1',
      userId: 'customer_1',
    });
    messageRepo.findOne.mockResolvedValue({
      id: 'ai-msg-existing',
      clientMessageId: 'event:order-confirmed:ord_1',
    });

    const saved = await service.saveAssistantEvent(
      'ai-chat_1',
      'customer_1',
      'order-confirmed:ord_1',
      'Order confirmed',
      [],
    );

    expect(saved.id).toBe('ai-msg-existing');
    expect(messageRepo.save).not.toHaveBeenCalled();
  });

  it('bounds model history by both message count and total text size', async () => {
    const newest = {
      id: 'newest',
      content: 'Current question',
      createdAt: new Date('2026-08-13T10:00:00Z'),
    };
    const recent = {
      id: 'recent',
      content: 'a'.repeat(20_000),
      createdAt: new Date('2026-08-13T09:59:00Z'),
    };
    const tooLarge = {
      id: 'too-large',
      content: 'b'.repeat(25_000),
      createdAt: new Date('2026-08-13T09:58:00Z'),
    };
    messageRepo.find.mockResolvedValue([newest, recent, tooLarge]);

    await expect(service.getModelHistory('ai-chat_1')).resolves.toEqual([
      recent,
      newest,
    ]);
    expect(messageRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ take: 30 }),
    );
  });
});

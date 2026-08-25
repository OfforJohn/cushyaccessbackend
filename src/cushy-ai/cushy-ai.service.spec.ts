import { CushyAIService } from './cushy-ai.service';

describe('CushyAIService orchestration', () => {
  const user = { id: 'customer_1', email: 'customer@example.com' };
  const chat = {
    id: 'ai-chat_1',
    userId: user.id,
    title: 'Find rice',
  };

  function setup(providerResponse: any) {
    const commonService = {
      getLoggedInUser: jest.fn().mockResolvedValue(user),
    };
    const conversationService = {
      resolveChat: jest.fn().mockResolvedValue(chat),
      acquireTurn: jest.fn().mockResolvedValue('lock-token'),
      renewTurn: jest.fn().mockResolvedValue(undefined),
      releaseTurn: jest.fn().mockResolvedValue(undefined),
      findIdempotentResponse: jest.fn().mockResolvedValue(null),
      findUserMessageByClientId: jest.fn().mockResolvedValue(null),
      saveUserMessage: jest.fn().mockResolvedValue({ id: 'ai-msg_1' }),
      getModelHistory: jest
        .fn()
        .mockResolvedValue([{ role: 'user', content: 'Find rice' }]),
      saveAssistantMessage: jest
        .fn()
        .mockImplementation((_chatId, content, components) => ({
          id: 'ai-msg_2',
          role: 'assistant',
          content,
          components,
          createdAt: new Date(),
        })),
      saveAssistantEvent: jest.fn(),
      toMessageDto: jest.fn().mockImplementation((message) => message),
      saveConversation: jest.fn().mockResolvedValue(undefined),
    };
    const tools = {
      definitions: [{ name: 'search_catalog', inputSchema: {} }],
      getDeliveryContext: jest.fn().mockResolvedValue({
        modelContent: {
          locationRequired: false,
          selectedLocation: {
            city: 'Minna',
            state: 'Niger',
            country: 'Nigeria',
          },
        },
      }),
      execute: jest.fn().mockResolvedValue({
        modelContent: { count: 1 },
        components: [{ id: 'product:1', type: 'product_card' }],
      }),
    };
    const ordersService = {
      findByIdForUser: jest.fn().mockResolvedValue({
        toJSON: () => ({
          data: {
            id: 'ord_1',
            deliveryCode: '123456',
          },
        }),
      }),
    };
    const provider = {
      name: 'test-provider',
      generate: jest.fn().mockResolvedValueOnce(providerResponse),
    };
    const service = new CushyAIService(
      commonService as any,
      conversationService as any,
      tools as any,
      ordersService as any,
      provider as any,
    );
    return {
      service,
      conversationService,
      tools,
      ordersService,
      provider,
    };
  }

  it('creates a real chat turn and returns a structured assistant message', async () => {
    const { service, conversationService } = setup({
      content: [{ type: 'text', text: 'Hello! How can I help?' }],
      stopReason: 'end_turn',
    });

    const response = await service.askCushyAI('How are you?', {
      newSession: true,
      clientMessageId: 'client_1',
    });

    expect(conversationService.resolveChat).toHaveBeenCalledWith(
      user.id,
      undefined,
      true,
      'How are you?',
    );
    expect(conversationService.saveAssistantMessage).toHaveBeenCalledWith(
      chat.id,
      'Hello! How can I help?',
      [],
      'ai-msg_1',
      { provider: 'test-provider' },
    );
    expect(response.toJSON().data).toEqual(
      expect.objectContaining({
        chatId: chat.id,
        reply: 'Hello! How can I help?',
      }),
    );
    expect(conversationService.releaseTurn).toHaveBeenCalled();
  });

  it('provides the saved delivery location without making the customer repeat it', async () => {
    const { service, provider } = setup({
      content: [{ type: 'text', text: 'What kind of snack would you like?' }],
      stopReason: 'end_turn',
    });

    await service.askCushyAI('I want to eat something', {
      chatId: chat.id,
    });

    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          '"source":"delivery_context","data":{"locationRequired":false,"selectedLocation":{"city":"Minna","state":"Niger","country":"Nigeria"}}',
        ),
      }),
    );
  });

  it.each([
    ['purchase-history meal recommendations'],
    ['food cravings and discovery'],
    ['ordering from a named merchant'],
    ['questions about Cushy AI identity and capabilities'],
    ['corrections to an earlier Cushy Access answer'],
  ])('does not pre-emptively block %s', async (intentClass) => {
    const { service, provider, conversationService } = setup({
      content: [
        {
          type: 'text',
          text: `Handled in-scope intent: ${intentClass}`,
        },
      ],
      stopReason: 'end_turn',
    });

    await service.askCushyAI(`In-scope request: ${intentClass}`, {
      chatId: chat.id,
      clientMessageId: `intent:${intentClass}`,
    });

    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(conversationService.saveAssistantMessage).toHaveBeenCalledWith(
      chat.id,
      `Handled in-scope intent: ${intentClass}`,
      expect.any(Array),
      'ai-msg_1',
      { provider: 'test-provider' },
    );
  });

  it('executes model tool calls and returns tool-generated components', async () => {
    const { service, tools, provider, conversationService } = setup({
      content: [
        {
          type: 'tool_call',
          id: 'call_1',
          name: 'search_catalog',
          input: { query: 'rice' },
        },
      ],
      stopReason: 'tool_use',
    });
    provider.generate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'I found rice near you.' }],
      stopReason: 'end_turn',
    });

    await service.askCushyAI('Find rice', { chatId: chat.id });

    expect(tools.execute).toHaveBeenCalledWith(
      'search_catalog',
      { query: 'rice' },
      user.id,
    );
    expect(conversationService.saveAssistantMessage).toHaveBeenCalledWith(
      chat.id,
      'I found rice near you.',
      [{ id: 'product:1', type: 'product_card' }],
      'ai-msg_1',
      { provider: 'test-provider' },
    );
  });

  it('does not save preliminary text emitted alongside a tool call as the final answer', async () => {
    const { service, provider, conversationService } = setup({
      content: [
        { type: 'text', text: "I'll search for that now." },
        {
          type: 'tool_call',
          id: 'call_1',
          name: 'search_catalog',
          input: { query: 'rice', requestedLocation: '' },
        },
      ],
      stopReason: 'tool_use',
    });
    provider.generate
      .mockResolvedValueOnce({ content: [], stopReason: 'end_turn' })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Here are the available rice meals.' }],
        stopReason: 'end_turn',
      });

    await service.askCushyAI('Find rice', { chatId: chat.id });

    expect(conversationService.saveAssistantMessage).toHaveBeenCalledWith(
      chat.id,
      'Here are the available rice meals.',
      expect.any(Array),
      'ai-msg_1',
      { provider: 'test-provider' },
    );
  });

  it('removes leaked component JSON and internal IDs from customer-visible prose', async () => {
    const { service, provider, conversationService } = setup({
      content: [
        {
          type: 'tool_call',
          id: 'call_1',
          name: 'search_catalog',
          input: { query: 'grilled chicken', requestedLocation: '' },
        },
      ],
      stopReason: 'tool_use',
    });
    provider.generate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: [
            'I found one option near you.',
            '',
            '**Menu card**',
            '```json',
            '{"type":"product_card","menuItemId":"mit_207efe04-0330-4024-8bfa-96c33b052a19"}',
            '```',
            '',
            'You can use the action below.',
          ].join('\n'),
        },
      ],
      stopReason: 'end_turn',
    });

    await service.askCushyAI('Find grilled chicken', { chatId: chat.id });

    const savedText = conversationService.saveAssistantMessage.mock.calls[0][1];
    expect(savedText).toBe(
      'I found one option near you.\n\nYou can use the action below.',
    );
    expect(savedText).not.toContain('product_card');
    expect(savedText).not.toContain('menuItemId');
    expect(savedText).not.toContain('mit_');
    expect(savedText).not.toContain('```');
  });

  it('uses singular wording when only one discovery result is available', async () => {
    const { service, provider, conversationService } = setup({
      content: [
        {
          type: 'tool_call',
          id: 'call_1',
          name: 'search_catalog',
          input: { query: 'grilled chicken', requestedLocation: '' },
        },
      ],
      stopReason: 'tool_use',
    });
    provider.generate.mockResolvedValueOnce({
      content: [],
      stopReason: 'end_turn',
    });

    await service.askCushyAI('Find a suitable meal', { chatId: chat.id });

    expect(conversationService.saveAssistantMessage).toHaveBeenCalledWith(
      chat.id,
      'I found one option available for your saved delivery location. You can review it below.',
      [{ id: 'product:1', type: 'product_card' }],
      'ai-msg_1',
      { provider: 'test-provider' },
    );
  });

  it('finishes a valid meal-discovery request when the model keeps requesting tools', async () => {
    const { service, tools, provider, conversationService } = setup({
      content: [
        {
          type: 'tool_call',
          id: 'search_0',
          name: 'search_catalog',
          input: { query: 'diabetes-friendly meals', category: 'restaurant' },
        },
      ],
      stopReason: 'tool_use',
    });
    let repeatedCall = 0;
    provider.generate.mockImplementation((request: any) => {
      if (request.tools.length === 0) {
        return Promise.resolve({
          content: [
            {
              type: 'text',
              text: 'I found currently available restaurant options and highlighted practical nutritional considerations.',
            },
          ],
          stopReason: 'end_turn',
        });
      }
      repeatedCall += 1;
      return Promise.resolve({
        content: [
          {
            type: 'tool_call',
            id: `search_${repeatedCall}`,
            name: 'search_catalog',
            input: {
              category: 'restaurant',
              query: 'diabetes-friendly meals',
            },
          },
        ],
        stopReason: 'tool_use',
      });
    });

    await service.askCushyAI(
      'Find currently available restaurant meals suitable for diabetes',
      { chatId: chat.id, clientMessageId: 'health-meals_1' },
    );

    expect(tools.execute).toHaveBeenCalledTimes(1);
    expect(provider.generate).toHaveBeenLastCalledWith(
      expect.objectContaining({ tools: [] }),
    );
    expect(conversationService.saveAssistantMessage).toHaveBeenCalledWith(
      chat.id,
      expect.stringContaining('currently available restaurant options'),
      [{ id: 'product:1', type: 'product_card' }],
      'ai-msg_1',
      { provider: 'test-provider' },
    );
  });

  it('replaces broad discovery cards when the model refines its catalog search', async () => {
    const { service, tools, provider, conversationService } = setup({
      content: [
        {
          type: 'tool_call',
          id: 'call_1',
          name: 'search_catalog',
          input: { query: 'rice' },
        },
      ],
      stopReason: 'tool_use',
    });
    tools.execute
      .mockResolvedValueOnce({
        modelContent: { count: 2 },
        components: [{ id: 'product:broad', type: 'product_card' }],
      })
      .mockResolvedValueOnce({
        modelContent: { count: 1 },
        components: [{ id: 'product:exact', type: 'product_card' }],
      });
    provider.generate
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_call',
            id: 'call_2',
            name: 'search_catalog',
            input: { query: 'jollof rice' },
          },
        ],
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Here is the exact match.' }],
        stopReason: 'end_turn',
      });

    await service.askCushyAI('Find jollof rice', { chatId: chat.id });

    expect(conversationService.saveAssistantMessage).toHaveBeenCalledWith(
      chat.id,
      'Here is the exact match.',
      [{ id: 'product:exact', type: 'product_card' }],
      'ai-msg_1',
      { provider: 'test-provider' },
    );
  });

  it('keeps complementary discovery results returned in the same tool round', async () => {
    const { service, tools, provider, conversationService } = setup({
      content: [
        {
          type: 'tool_call',
          id: 'call_chicken',
          name: 'search_catalog',
          input: { query: 'grilled chicken', requestedLocation: '' },
        },
        {
          type: 'tool_call',
          id: 'call_fish',
          name: 'search_catalog',
          input: { query: 'grilled fish', requestedLocation: '' },
        },
      ],
      stopReason: 'tool_use',
    });
    tools.execute.mockImplementation((_name: string, input: any) =>
      Promise.resolve({
        modelContent: { count: 1, query: input.query },
        components: [
          {
            id: `product:${input.query}`,
            type: 'product_card',
            title: input.query,
          },
        ],
      }),
    );
    provider.generate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'I found two suitable options.' }],
      stopReason: 'end_turn',
    });

    await service.askCushyAI('Find a few suitable grilled meals', {
      chatId: chat.id,
    });

    expect(conversationService.saveAssistantMessage).toHaveBeenCalledWith(
      chat.id,
      'I found two suitable options.',
      [
        expect.objectContaining({ id: 'product:grilled chicken' }),
        expect.objectContaining({ id: 'product:grilled fish' }),
      ],
      'ai-msg_1',
      { provider: 'test-provider' },
    );
  });

  it('retries once with a concise synthesis when provider output is truncated', async () => {
    const { service, provider, conversationService } = setup({
      content: [{ type: 'text', text: 'This answer was cut off halfway' }],
      stopReason: 'max_tokens',
    });
    provider.generate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: 'Here is the complete concise nutritional guidance.',
        },
      ],
      stopReason: 'end_turn',
    });

    await service.askCushyAI('Explain this meal briefly', { chatId: chat.id });

    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        tools: [],
        systemPrompt: expect.stringContaining('under 500 words'),
      }),
    );
    expect(conversationService.saveAssistantMessage).toHaveBeenCalledWith(
      chat.id,
      'Here is the complete concise nutritional guidance.',
      [],
      'ai-msg_1',
      { provider: 'test-provider' },
    );
  });

  it('removes discovery cards after preparing the selected add-to-cart action', async () => {
    const { service, tools, provider, conversationService } = setup({
      content: [
        {
          type: 'tool_call',
          id: 'call_1',
          name: 'search_catalog',
          input: { query: 'jollof rice' },
        },
      ],
      stopReason: 'tool_use',
    });
    tools.execute
      .mockResolvedValueOnce({
        modelContent: { count: 2 },
        components: [
          { id: 'product:one', type: 'product_card' },
          { id: 'product:two', type: 'product_card' },
        ],
      })
      .mockResolvedValueOnce({
        modelContent: { ready: true },
        components: [{ id: 'cart:add-one', type: 'cart_card' }],
      });
    provider.generate
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_call',
            id: 'call_2',
            name: 'prepare_add_to_cart',
            input: { menuItemId: 'one' },
          },
        ],
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Ready to add.' }],
        stopReason: 'end_turn',
      });

    await service.askCushyAI('Add the first one', { chatId: chat.id });

    expect(conversationService.saveAssistantMessage).toHaveBeenCalledWith(
      chat.id,
      'Ready to add.',
      [{ id: 'cart:add-one', type: 'cart_card' }],
      'ai-msg_1',
      { provider: 'test-provider' },
    );
  });

  it('does not let a parallel discovery call overwrite a prepared cart action', async () => {
    const { service, tools, provider, conversationService } = setup({
      content: [
        {
          type: 'tool_call',
          id: 'prepare_call',
          name: 'prepare_add_to_cart',
          input: { menuItemId: 'one' },
        },
        {
          type: 'tool_call',
          id: 'search_call',
          name: 'search_catalog',
          input: { query: 'rice', requestedLocation: '' },
        },
      ],
      stopReason: 'tool_use',
    });
    tools.execute.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'prepare_add_to_cart'
          ? {
              modelContent: { validated: true },
              components: [{ id: 'product-confirm:one', type: 'product_card' }],
            }
          : {
              modelContent: { count: 1 },
              components: [{ id: 'product:other', type: 'product_card' }],
            },
      ),
    );
    provider.generate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Ready for your confirmation.' }],
      stopReason: 'end_turn',
    });

    await service.askCushyAI('Add that one and show rice', { chatId: chat.id });

    expect(conversationService.saveAssistantMessage).toHaveBeenCalledWith(
      chat.id,
      'Ready for your confirmation.',
      [expect.objectContaining({ id: 'product-confirm:one' })],
      'ai-msg_1',
      { provider: 'test-provider' },
    );
  });

  it('returns a safe service error and releases the lock when the provider fails', async () => {
    const { service, provider, conversationService } = setup({});
    provider.generate.mockReset().mockRejectedValue(new Error('provider down'));

    await expect(
      service.askCushyAI('Hello', { chatId: chat.id }),
    ).rejects.toThrow('CUSHY_AI_TEMPORARILY_UNAVAILABLE');
    expect(conversationService.releaseTurn).toHaveBeenCalledWith(
      chat.id,
      user.id,
      'lock-token',
    );
  });

  it('adds deterministic emergency guidance even if the model omits it', async () => {
    const { service, tools, conversationService } = setup({
      content: [{ type: 'text', text: 'I can help you find care.' }],
      stopReason: 'end_turn',
    });

    await service.askCushyAI('I have chest pain and cannot breathe', {
      chatId: chat.id,
      clientMessageId: 'urgent_1',
    });

    expect(tools.execute).toHaveBeenCalledWith(
      'open_health_consultation',
      expect.objectContaining({ urgent: true }),
      user.id,
    );
    expect(conversationService.saveAssistantMessage).toHaveBeenCalledWith(
      chat.id,
      expect.stringContaining('Call 112'),
      expect.any(Array),
      'ai-msg_1',
      { provider: 'test-provider' },
    );
  });

  it('does not turn general condition-management food guidance into an emergency', async () => {
    const { service, tools, conversationService } = setup({
      content: [
        {
          type: 'text',
          text: 'I can help with general meal considerations for that condition.',
        },
      ],
      stopReason: 'end_turn',
    });

    await service.askCushyAI(
      'What foods may suit someone managing seizures after a past stroke?',
      { chatId: chat.id, clientMessageId: 'education_1' },
    );

    expect(tools.execute).not.toHaveBeenCalledWith(
      'open_health_consultation',
      expect.anything(),
      user.id,
    );
    const savedText = conversationService.saveAssistantMessage.mock.calls[0][1];
    expect(savedText).not.toContain('Call 112');
  });

  it('does not let food wording suppress a present dangerous symptom', async () => {
    const { service, tools, conversationService } = setup({
      content: [{ type: 'text', text: 'Please get emergency help now.' }],
      stopReason: 'end_turn',
    });

    await service.askCushyAI('My father has chest pain after a meal', {
      chatId: chat.id,
      clientMessageId: 'urgent_meal_1',
    });

    expect(tools.execute).toHaveBeenCalledWith(
      'open_health_consultation',
      expect.objectContaining({ urgent: true }),
      user.id,
    );
    expect(conversationService.saveAssistantMessage).toHaveBeenCalledWith(
      chat.id,
      expect.stringContaining('Call 112'),
      expect.any(Array),
      'ai-msg_1',
      { provider: 'test-provider' },
    );
  });

  it('does not treat incidental food wording as non-urgent medical guidance', async () => {
    const { service, tools, conversationService } = setup({
      content: [{ type: 'text', text: 'Please get emergency help now.' }],
      stopReason: 'end_turn',
    });

    await service.askCushyAI(
      'My brother became unconscious after eating food',
      { chatId: chat.id, clientMessageId: 'urgent_food_1' },
    );

    expect(tools.execute).toHaveBeenCalledWith(
      'open_health_consultation',
      expect.objectContaining({ urgent: true }),
      user.id,
    );
    const savedText = conversationService.saveAssistantMessage.mock.calls[0][1];
    expect(savedText).toContain('Call 112');
  });

  it('keeps explicit stroke-related food guidance non-urgent', async () => {
    const { service, tools, conversationService } = setup({
      content: [
        { type: 'text', text: 'Here are general food considerations.' },
      ],
      stopReason: 'end_turn',
    });

    await service.askCushyAI('Recommend meals for stroke recovery', {
      chatId: chat.id,
      clientMessageId: 'stroke_food_1',
    });

    expect(tools.execute).not.toHaveBeenCalledWith(
      'open_health_consultation',
      expect.anything(),
      user.id,
    );
    const savedText = conversationService.saveAssistantMessage.mock.calls[0][1];
    expect(savedText).not.toContain('Call 112');
  });

  it('injects authenticated order history even when the model omits a tool call', async () => {
    const { service, tools, provider } = setup({
      content: [{ type: 'text', text: 'You often order rice.' }],
      stopReason: 'end_turn',
    });

    await service.askCushyAI('Recommend food based on my past orders', {
      chatId: chat.id,
      clientMessageId: 'history_1',
    });

    expect(tools.execute).toHaveBeenCalledWith(
      'get_recent_orders',
      { includeCards: false },
      user.id,
    );
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('get_recent_orders'),
      }),
    );
  });

  it('records a verified order result as an idempotent chat event', async () => {
    const { service, conversationService, ordersService } = setup({});
    conversationService.saveAssistantEvent.mockResolvedValue({
      id: 'ai-msg-order',
      role: 'assistant',
      content:
        'Your order has been placed successfully. You can track it here.',
      components: [],
    });

    await service.recordOrderResult(chat.id, 'ord_1');

    expect(ordersService.findByIdForUser).toHaveBeenCalledWith(
      'ord_1',
      user.id,
    );
    expect(conversationService.saveAssistantEvent).toHaveBeenCalledWith(
      chat.id,
      user.id,
      'order-confirmed:ord_1',
      expect.stringContaining('placed successfully'),
      [
        expect.objectContaining({
          id: 'order:ord_1',
          type: 'order_card',
          actions: [
            expect.objectContaining({
              type: 'OPEN_ORDER',
              label: 'View order',
            }),
          ],
        }),
      ],
    );
  });

  it.each([
    [
      'Track my current order',
      'OPEN_ORDER',
      'OPEN_ORDER_TRACKING',
      'Track order',
    ],
    [
      "What's the status of my current order?",
      'OPEN_ORDER_TRACKING',
      'OPEN_ORDER',
      'View order',
    ],
  ])(
    'enforces the customer order intent for %s',
    async (prompt, toolAction, expectedAction, expectedLabel) => {
      const { service, tools, conversationService } = setup({
        content: [{ type: 'text', text: 'Here is the current update.' }],
        stopReason: 'end_turn',
      });
      tools.execute.mockResolvedValue({
        modelContent: {
          found: true,
          orderId: 'ord_1',
          status: 'PICKED_UP',
        },
        components: [
          {
            id: 'order:ord_1',
            type: 'order_card',
            title: 'Order',
            data: {
              orderId: 'ord_1',
              status: 'PICKED_UP',
              currentOrderIntent: true,
            },
            actions: [
              {
                type: toolAction,
                label: 'Wrong action',
                payload: { orderId: 'ord_1' },
              },
            ],
          },
        ],
      });

      await service.askCushyAI(prompt, { chatId: chat.id });

      expect(conversationService.saveAssistantMessage).toHaveBeenCalledWith(
        chat.id,
        'Here is the current update.',
        [
          expect.objectContaining({
            actions: [
              expect.objectContaining({
                type: expectedAction,
                label: expectedLabel,
              }),
            ],
          }),
        ],
        'ai-msg_1',
        { provider: 'test-provider' },
      );
    },
  );

  it('does not turn historical order cards into tracking actions', async () => {
    const { service, tools, conversationService } = setup({
      content: [{ type: 'text', text: 'Here is your current order.' }],
      stopReason: 'end_turn',
    });
    tools.execute.mockResolvedValue({
      modelContent: { found: true },
      components: [
        {
          id: 'order:current',
          type: 'order_card',
          title: 'Current order',
          data: {
            orderId: 'current',
            status: 'PICKED_UP',
            currentOrderIntent: true,
          },
          actions: [],
        },
        {
          id: 'order:historical',
          type: 'order_card',
          title: 'Historical order',
          data: { orderId: 'historical', status: 'DELIVERED' },
          actions: [
            {
              type: 'OPEN_ORDER',
              label: 'View order',
              payload: { orderId: 'historical' },
            },
          ],
        },
      ],
    });

    await service.askCushyAI('Track my current order', { chatId: chat.id });

    const savedComponents = conversationService.saveAssistantMessage.mock
      .calls[0][2] as any[];
    expect(savedComponents[0].actions[0].type).toBe('OPEN_ORDER_TRACKING');
    expect(savedComponents[1].actions[0].type).toBe('OPEN_ORDER');
  });

  it('merges consecutive persisted roles before calling conversation providers', async () => {
    const { service, conversationService, provider } = setup({
      content: [{ type: 'text', text: 'What would you like next?' }],
      stopReason: 'end_turn',
    });
    conversationService.getModelHistory.mockResolvedValue([
      { role: 'user', content: 'Add rice' },
      { role: 'assistant', content: 'Ready for checkout.' },
      { role: 'assistant', content: 'Your order was confirmed.' },
      { role: 'user', content: 'What did I order?' },
    ]);

    await service.askCushyAI('What did I order?', { chatId: chat.id });

    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({ role: 'user' }),
          expect.objectContaining({
            role: 'assistant',
            content: [
              { type: 'text', text: 'Ready for checkout.' },
              { type: 'text', text: 'Your order was confirmed.' },
            ],
          }),
          expect.objectContaining({ role: 'user' }),
        ],
      }),
    );
  });

  it('includes sanitized prior card context for conversational follow-ups', async () => {
    const { service, conversationService, provider } = setup({
      content: [{ type: 'text', text: 'Ready to add that item.' }],
      stopReason: 'end_turn',
    });
    conversationService.getModelHistory.mockResolvedValue([
      { role: 'user', content: 'Show me rice' },
      {
        role: 'assistant',
        content: 'I found a few options.',
        components: [
          {
            id: 'product:rice_1',
            type: 'product_card',
            title: 'Jollof rice',
            data: {
              menuItemId: 'rice_1',
              merchantName: 'Food Hub',
              description: 'Smoky rice with tomato and peppers.',
              distanceKm: 1.4,
              secretInternalField: 'must-not-leak',
            },
            actions: [
              {
                type: 'OPEN_PRODUCT',
                label: 'View item',
                payload: { menuItemId: 'rice_1', storeId: 'store_1' },
              },
              {
                type: 'ADD_TO_CART',
                label: 'Add to cart',
                payload: {
                  menuItemId: 'rice_1',
                  fullHouseAddress: 'private address',
                },
              },
            ],
          },
        ],
      },
      { role: 'user', content: 'Add the first one' },
    ]);

    await service.askCushyAI('Add the first one', { chatId: chat.id });

    const request = provider.generate.mock.calls[0][0];
    const serializedMessages = JSON.stringify(request.messages);
    expect(serializedMessages).toContain('Jollof rice');
    expect(serializedMessages).toContain('rice_1');
    expect(serializedMessages).toContain('internalMenuItemRef=rice_1');
    expect(serializedMessages).toContain(
      'catalogDescription=Smoky rice with tomato and peppers.',
    );
    expect(serializedMessages).toContain('distanceKm=1.4');
    expect(serializedMessages).toContain(
      'availableActions=OPEN_PRODUCT,ADD_TO_CART',
    );
    expect(serializedMessages).not.toContain('Previously rendered app cards');
    expect(serializedMessages).not.toContain('"actions"');
    expect(serializedMessages).not.toContain('must-not-leak');
    expect(serializedMessages).not.toContain('private address');
  });
});

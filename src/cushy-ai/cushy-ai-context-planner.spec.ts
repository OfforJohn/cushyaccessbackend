import { planAiContext } from './cushy-ai-context-planner';

describe('planAiContext', () => {
  it.each([
    ['What is my Cushcoin balance?', 'get_wallet_balance'],
    ['Recommend meals based on my past orders', 'get_recent_orders'],
    ['Where is my current order?', 'get_order_status'],
    ['How can I fund my wallet?', 'search_company_knowledge'],
  ])('plans live context for %s', (prompt, tool) => {
    expect(planAiContext(prompt).map((item) => item.name)).toContain(tool);
  });

  it('uses order history as model context without attaching irrelevant cards for recommendations', () => {
    expect(
      planAiContext('Recommend meals based on my past orders'),
    ).toContainEqual({
      name: 'get_recent_orders',
      input: { includeCards: false },
    });
  });

  it('does not prefetch discovery cards before the requested location is known to the tool', () => {
    expect(planAiContext('Show nearby restaurants in Jos')).toEqual([]);
  });

  it.each([
    'How are you?',
    'Tell me about healthy rice meals',
    'I want to order jollof rice',
  ])('does not force tools for ordinary conversation: %s', (prompt) => {
    expect(planAiContext(prompt)).toEqual([]);
  });

  it.each([
    ['Track my current order', 'track'],
    ['Where is my latest order?', 'track'],
    ['Open the live map for my order', 'track'],
    ["What's the status of my order?", 'status'],
    ['Give me an update on my current order', 'status'],
  ])('distinguishes order intent for %s', (prompt, intent) => {
    expect(planAiContext(prompt)).toContainEqual({
      name: 'get_order_status',
      input: { intent },
    });
  });
});

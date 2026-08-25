export type PlannedAiContextTool = {
  name: string;
  input: Record<string, unknown>;
};

export type OrderRequestIntent = 'status' | 'track';

const RECENT_ORDERS =
  /\b(order history|past orders?|previous orders?|recent orders?|ordered before|usually order|recurring (?:orders?|preferences?)|based on (?:my )?orders?|based on my history)\b/i;
const ORDER_RECOMMENDATION =
  /\b(recommend|suggest|discover|preference|likely to enjoy|alternatives?|similar|based on)\b/i;
const WALLET_BALANCE =
  /\b(?:wallet|cushcoins?)\b.{0,30}\b(?:balance|how much|amount|available|left|have)\b|\b(?:balance|how much|amount|available|left)\b.{0,30}\b(?:wallet|cushcoins?)\b/i;
const ORDER_TRACKING =
  /\b(track|tracking|live (?:track|tracking|map)|follow|where is|where's|whereabouts|rider location)\b.{0,50}\b(?:my |the )?(?:latest |current |active )?orders?\b|\b(?:my |the )?(?:latest |current |active )?orders?\b.{0,50}\b(?:track|tracking|live (?:track|tracking|map)|follow|where|location|rider)\b/i;
const ORDER_STATUS =
  /\b(status|state|update|progress|what happened to)\b.{0,50}\b(?:my |the )?(?:latest |current |active )?orders?\b|\b(?:my |the )?(?:latest |current |active )?orders?\b.{0,50}\b(?:status|state|update|progress|accepted|acknowledged|picked up|in transit|delivered|cancelled|on the way)\b/i;
const CART = /\b(?:my |the )?cart\b/i;
const COMPANY_INFO =
  /\b(cushy access|customer fees?|service fees?|delivery fees?|cushcoin|birthday|rewards?|advertis(?:e|ing)|change (?:my )?(?:email|phone|number)|contact support|human support|how (?:does )?(?:the )?app work|book (?:a )?(?:consultation|logistics)|fund (?:my )?wallet)\b/i;

export function getOrderRequestIntent(
  prompt: string,
): OrderRequestIntent | undefined {
  if (ORDER_TRACKING.test(prompt)) return 'track';
  if (ORDER_STATUS.test(prompt)) return 'status';
  return undefined;
}

/**
 * Selects only high-confidence, read-only tools. This guarantees that obvious
 * account questions receive live backend facts even if a model omits a tool
 * call, without turning ordinary conversation into a deterministic chatbot.
 */
export function planAiContext(prompt: string): PlannedAiContextTool[] {
  const planned: PlannedAiContextTool[] = [];
  if (RECENT_ORDERS.test(prompt)) {
    planned.push({
      name: 'get_recent_orders',
      input: { includeCards: !ORDER_RECOMMENDATION.test(prompt) },
    });
  }
  if (WALLET_BALANCE.test(prompt)) {
    planned.push({ name: 'get_wallet_balance', input: {} });
  }
  const orderIntent = getOrderRequestIntent(prompt);
  if (orderIntent) {
    planned.push({ name: 'get_order_status', input: { intent: orderIntent } });
  }
  if (CART.test(prompt)) {
    planned.push({ name: 'get_cart', input: {} });
  }
  if (COMPANY_INFO.test(prompt)) {
    planned.push({
      name: 'search_company_knowledge',
      input: { query: prompt.slice(0, 200) },
    });
  }
  return planned.slice(0, 3);
}

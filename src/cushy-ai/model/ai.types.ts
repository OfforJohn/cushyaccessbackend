export type AiComponentType =
  | 'product_card'
  | 'merchant_card'
  | 'wallet_card'
  | 'order_card'
  | 'cart_card'
  | 'navigation_card'
  | 'emergency_card'
  | 'support_card'
  | 'checkout_card'
  | 'funding_card';

export interface AiAction {
  type:
    | 'OPEN_PRODUCT'
    | 'OPEN_MERCHANT'
    | 'ADD_TO_CART'
    | 'OPEN_CART'
    | 'OPEN_ORDER'
    | 'OPEN_ORDER_TRACKING'
    | 'OPEN_WALLET'
    | 'OPEN_LOCATION'
    | 'OPEN_SUPPORT'
    | 'OPEN_HEALTH_CONSULTATION'
    | 'CALL_EMERGENCY'
    | 'CONFIRM_ORDER'
    | 'REFRESH_CHECKOUT';
  label: string;
  payload?: Record<string, unknown>;
}

export interface AiComponent {
  id: string;
  type: AiComponentType;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  data?: Record<string, unknown>;
  actions: AiAction[];
}

export interface AiToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type AiContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      toolCallId: string;
      name?: string;
      content: string;
      isError?: boolean;
    };

export interface AiModelMessage {
  role: 'user' | 'assistant';
  content: AiContentBlock[];
}

export interface AiModelRequest {
  systemPrompt: string;
  messages: AiModelMessage[];
  tools: AiToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  toolChoice?: 'auto' | 'required';
}

export interface AiModelResponse {
  content: AiContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'unknown';
}

export interface AiProvider {
  readonly name: string;
  generate(request: AiModelRequest): Promise<AiModelResponse>;
}

export interface AiToolResult {
  modelContent: Record<string, unknown>;
  components?: AiComponent[];
}

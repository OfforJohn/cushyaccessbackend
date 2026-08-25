export interface WebHookEvent {
  event: string;
  data: PaystackResponseData;
}

interface PaystackResponseData {
  id: number;
  domain: string;
  reference: string;
  transfer_code?: string;
  status: string;
  amount: number;
  message: string;
  gateway_response: string;
  paid_at: string;
  created_at: string;
  channel: string;
  currency: 'NGN';
  ip_address: string | null;
  metadata: {
    receiver_account_number: string;
    receiver_bank: string;
    receiver_account_type: null;
    custom_fields: [];
  };
  fees_breakdown: { amount: string; formula: null; type: string };
  log: null;
  fees: number;
  fees_split: null | any;
  authorization: {
    authorization_code: string;
    bin: string;
    last4: string;
    exp_month: string;
    exp_year: string;
    channel: string;
    card_type: string;
    bank: string;
    country_code: 'NG';
    brand: string;
    reusable: boolean;
    signature: null | any;
    account_name: null | any;
    sender_country: 'NG';
    sender_bank: string;
    sender_bank_account_number: string;
    sender_name: string;
    narration: string;
    receiver_bank_account_number: string;
    receiver_bank: string;
  };
  customer: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    customer_code: string;
    phone: string;
    metadata: any;
    risk_action: string;
    international_format_phone: string;
  };
  plan: any;
  subaccount: any;
  split: any;
  order_id: null;
  paidAt: string;
  requested_amount: number;
  pos_transaction_data: null | any;
  source: null | any;
}

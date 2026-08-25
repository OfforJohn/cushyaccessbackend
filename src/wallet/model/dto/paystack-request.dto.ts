interface PaystackBank {
  name: string;
  id: number;
  slug: string;
}

interface PaystackAssignment {
  integration: number;
  assignee_id: number;
  assignee_type: string;
  expired: boolean;
  account_type: string;
  assigned_at: string;
  expired_at: string | null;
  assignment_expires_at: string | null;
}

export interface PaystackCustomer {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  customer_code: string;
  phone: string;
  metadata: Record<string, unknown>;
  risk_action: string;
  international_format_phone: string | null;
  dedicated_account?: PaystackVirtualAccount | null;
}

export interface PaystackVirtualAccount {
  bank: PaystackBank;
  account_name: string;
  account_number: string;
  assigned: boolean;
  currency: string;
  metadata: any; // Can be replaced with a stricter type if structure is known
  active: boolean;
  id: number;
  created_at: string;
  updated_at: string;
  assignment: PaystackAssignment;
  customer: PaystackCustomer;
}

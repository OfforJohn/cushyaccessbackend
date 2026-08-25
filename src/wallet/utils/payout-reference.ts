import { v4 as uuidv4 } from 'uuid';

export type PayoutReferenceType = 'payout' | 'dpayout';

export const createPayoutReference = (type: PayoutReferenceType) =>
  `${type}-${Date.now()}-${uuidv4().slice(0, 6)}`;

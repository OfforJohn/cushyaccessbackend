import { PromoCodes } from '../../promo-code/model/promo-code.entity';

export class PromoCodeConsumeEvent {
  constructor(
    public readonly promoCode: PromoCodes,
    public readonly userId: string,
    public readonly orderId?: string,
  ) {}
}

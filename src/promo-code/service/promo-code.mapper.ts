import { PromoCodeResponseDto } from '../dto/promo-code.response';
import { PromoCodes } from '../model/promo-code.entity';

export class PromoCodeMapper {
  static toResponseDto(
    promoCode: PromoCodes,
    totalUsage?: number,
  ): PromoCodeResponseDto {
    const ambassadorFullName = `${promoCode?.ambassador?.firstName} ${promoCode?.ambassador?.lastName}`;
    return {
      id: promoCode.id,
      ambassadorId: promoCode.ambassador?.id,
      ambassadorsFullName: promoCode.ambassador
        ? ambassadorFullName
        : undefined,
      ambassadorsReward: promoCode.ambassadorsReward,
      consumersReward: promoCode.consumersReward,
      isDisabled: promoCode.isDisabled,
      codeValue: promoCode.codeValue,
      totalUsage: totalUsage,
    };
  }
}

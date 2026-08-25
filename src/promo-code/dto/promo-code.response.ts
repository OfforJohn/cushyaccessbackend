export class PromoCodeResponseDto {
  id: string;
  ambassadorId: string;
  ambassadorsFullName: string;
  ambassadorsReward: number;
  consumersReward: number;
  isDisabled: boolean;
  codeValue: string;
  totalUsage: number;
}

import { IsString, IsOptional } from 'class-validator';
export class ApplyCouponDto {
  @IsString() code: string;
  @IsOptional() storeId?: string; // optional fallback
}

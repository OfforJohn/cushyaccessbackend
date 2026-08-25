import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { CouponType } from '../model/coupon.entity';

export class CreateCouponDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'code cannot contain only whitespace' })
  code: string;

  @IsEnum(CouponType)
  type: CouponType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  value: number; // percent decimal or fixed amount

  @IsString()
  @IsOptional()
  appliesTo?: string; // 'SITE' or merchantId

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  usageLimit?: number;
}

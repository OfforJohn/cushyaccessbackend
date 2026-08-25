import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export type BulkWalletAdjustmentType = 'credit' | 'debit';

export class BulkWalletAdjustmentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  userIds: string[];

  @IsIn(['credit', 'debit'])
  type: BulkWalletAdjustmentType;

  @IsOptional()
  @IsBoolean()
  debitAll?: boolean;

  @ValidateIf((dto: BulkWalletAdjustmentDto) => !dto.debitAll)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Min(0.01)
  @Max(99_999_999.99)
  amount?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;
}

import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class MenuOptionChoiceRequest {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  id?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Choice name is required' })
  @MaxLength(80)
  name: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  priceAdjustment: number;
}

export class MenuOptionGroupRequest {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean = true;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean = false;

  @IsOptional()
  @IsBoolean()
  allowMultiple?: boolean = false;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MenuOptionChoiceRequest)
  @IsArray()
  @ArrayMaxSize(30)
  choices?: MenuOptionChoiceRequest[] = [];
}

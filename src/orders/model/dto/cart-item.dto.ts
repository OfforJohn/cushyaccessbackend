import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SelectedMenuOptionDto {
  @IsNotEmpty()
  @IsString()
  groupId: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  choiceIds: string[];
}

export class CartItemDto {
  // @IsNotEmpty()
  // @IsString()
  // menuCategoryId: string;

  @IsNotEmpty()
  @IsString()
  menuItemId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Max(100)
  quantity: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SelectedMenuOptionDto)
  selectedOptions?: SelectedMenuOptionDto[];

  @IsOptional()
  @IsString()
  noteForRider?: string;

  @IsOptional()
  @IsString()
  noteForVendor?: string;
}

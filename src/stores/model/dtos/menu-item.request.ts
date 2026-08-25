import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  Min,
  MaxLength,
  ArrayMaxSize,
  ValidateIf,
  Max,
  IsDateString,
} from 'class-validator';

export class MenuItemRequest {
  @IsNotEmpty({ message: 'Menu category ID is required' })
  menuCategoryId: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  optionGroupIds?: string[];

  @IsNotEmpty({ message: 'Name is required' })
  @IsString({ message: 'Name must be a string' })
  name: string;

  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  @MaxLength(500, { message: 'Description cannot exceed 500 characters' })
  description?: string;

  @IsOptional()
  @IsArray({ message: 'Images must be an array' })
  @IsString({ each: true, message: 'Each image must be a string URL' })
  @ArrayMaxSize(5, { message: 'Cannot upload more than 5 images' })
  images?: string[];

  @IsNotEmpty({ message: 'Price is required' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Price must be a number with maximum 2 decimal places' },
  )
  @Min(0, { message: 'Price cannot be negative' })
  price: number;

  @IsOptional()
  @IsBoolean({ message: 'Availability must be a boolean' })
  isAvailable?: boolean = true;

  @IsOptional()
  @IsBoolean()
  isDiscountActive?: boolean;

  @ValidateIf((o) => o.discountPercentage == null)
  @IsOptional()
  @IsNumber()
  discountPrice?: number;

  @ValidateIf((o) => o.discountPrice == null)
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(90)
  discountPercentage?: number;

  @IsOptional()
  @IsDateString()
  discountStart?: Date;

  @IsOptional()
  @IsDateString()
  discountEnd?: Date;
}

import {
    IsOptional,
    IsNumber,
    IsBoolean,
    Min,
    Max,
    IsDateString,
    ValidateIf,
} from 'class-validator';
  
export class UpdateMenuDiscountDto {
    @IsOptional()
    @IsBoolean()
    isDiscountActive?: boolean;
  
    @ValidateIf((o) => o.discountPercentage === undefined)
    @IsOptional()
    @IsNumber()
    discountPrice?: number;
  
    @ValidateIf((o) => o.discountPrice === undefined)
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
  
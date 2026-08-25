import { Type } from "class-transformer";
import { IsNotEmpty, IsNumber, IsPositive, IsString, Max, Min } from "class-validator";

export class ManualFundingDto {
    @IsString()
    @IsNotEmpty()
    userId: string;
    
    @IsNotEmpty()
    @IsNumber()
    @IsPositive()
    @Min(0.01)
    @Max(100000000) // Set reasonable max limit
    @Type(() => Number)
    amount: number;

    @IsString()
    @IsNotEmpty()
    description: string;
}
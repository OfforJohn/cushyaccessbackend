import { IsNotEmpty, IsString, IsUrl, IsOptional } from 'class-validator';

export class UpdateVendorPayoutDto {
    @IsNotEmpty()
    @IsString()
    bankName: string;

    @IsNotEmpty()
    @IsString()
    accountNumber: string;

    @IsNotEmpty()
    @IsString()
    accountName: string;

    @IsNotEmpty()
    @IsString()
    bankCode: string;
}

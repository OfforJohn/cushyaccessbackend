import { IsNotEmpty, IsNumber, IsString, IsOptional } from 'class-validator';

export class CreateManualPayoutDto {
  @IsNotEmpty()
  @IsString()
  vendorId: string; // Vendor's user ID

  @IsNotEmpty()
  @IsNumber()
  amount: number; // Payout amount in Naira

  @IsNotEmpty()
  @IsString()
  bankName: string; // Bank name

  @IsNotEmpty()
  @IsString()
  accountNumber: string; // Vendor's bank account number

  @IsNotEmpty()
  @IsString()
  accountName: string; // Account holder's name

  @IsNotEmpty()
  @IsString()
  reference: string; // Manual reference, must be unique

  @IsOptional()
  @IsString()
  narration?: string; // Optional description or note for the payout

  @IsOptional()
  @IsString()
  providerReference?: string; // Optional provider reference (Paystack, etc.)
}

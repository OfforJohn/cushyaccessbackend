import { IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class SuspendStoreDto {
  @IsString()
  @MinLength(5)
  @ValidateIf(o => o.isSuspended === true)
  suspensionReason: string;
}

export class UnsuspendStoreDto {
  @IsOptional()
  @IsString()
  @MinLength(5)
  unsuspendNotes?: string;
}

export class StoreAppealDto {
  @IsString()
  @MinLength(10)
  message: string;
}

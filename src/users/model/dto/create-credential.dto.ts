import { IsEnum, IsNotEmpty, IsOptional, IsUrl, Length } from 'class-validator';
import { StoreCategory } from '../../../stores/model/enums/store.category';

export class CreateCredentialDTO {
  @IsNotEmpty({ message: 'Government ID is required' })
  @IsUrl({}, { message: 'Government ID must be a valid URL' })
  governmentId: string;

  @IsNotEmpty({ message: 'CAC URL is required' })
  @IsUrl({}, { message: 'CAC URL must be a valid URL' })
  cacURL: string;

  @IsNotEmpty({ message: 'Proof of Address URL is required' })
  @IsUrl({}, { message: 'Proof of Address URL must be a valid URL' })
  proofOfAddressURL: string;

  @IsOptional()
  @IsUrl({}, { message: 'Pharmacy License URL must be a valid URL' })
  pharmacyLicenseURL?: string;

  @IsEnum(StoreCategory, {
    message: 'vendorCategory must be a valid StoreCategory enum value',
  })
  vendorCategory: StoreCategory; // e.g., 'PHARMACY', 'HOSPITAL', etc.
}

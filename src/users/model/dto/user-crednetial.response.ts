import { StoreCategory } from '../../../stores/model/enums/store.category';
import { UserCredentialStatus } from '../user-credential.enum';

export class UserCredentialResponse {
  id: string;

  governmentId: string;

  bvn: string;

  cacURL: string; //image URL for the CAC document

  proofOfAddressURL: string; //image URL for the proof of address document

  pharmacyLicenseURL: string; //image URL for the pharmacy license document

  status: UserCredentialStatus; // e.g., 'PENDING', 'APPROVED', 'REJECTED'

  reason: string;

  vendorCategory: StoreCategory; // e.g., 'PHARMACY', 'HOSPITAL', etc.

  createdAt: Date;

  updatedAt: Date;
}

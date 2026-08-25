import { IsOptional, IsEnum } from 'class-validator';
import { UserCredentialStatus } from 'src/users/model/user-credential.enum';

export class VendorVerificationDto {
  @IsEnum(UserCredentialStatus, {
    message: 'Status must be either APPROVED or REJECTED',
  })
  status: UserCredentialStatus;

  @IsOptional()
  reason?: string; // Optional reason for rejection
}

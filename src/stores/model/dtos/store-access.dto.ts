import {
  IsByteLength,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateStoreAccessDto {
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  @IsByteLength(0, 72, {
    message: 'password must not exceed 72 bytes',
  })
  @Matches(/\S/, { message: 'password must not be blank' })
  password: string;
}

export class StorePasswordDto extends CreateStoreAccessDto {}

export class ConfigureStorePasswordDto extends CreateStoreAccessDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  accountPassword: string;
}

export class ResetStorePasswordDto extends CreateStoreAccessDto {
  @IsString()
  @Length(4, 4)
  @Matches(/^\d{4}$/)
  otp: string;
}

export class ImportStoreMenuDto extends StorePasswordDto {
  @IsString()
  @IsNotEmpty()
  sourceStoreId: string;
}

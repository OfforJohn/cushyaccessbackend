import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  IsDateString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  EMAIL_MAX_LENGTH,
  PERSON_NAME_MAX_LENGTH,
  PERSON_NAME_MIN_LENGTH,
  PERSON_NAME_PATTERN,
  PERSON_NAME_VALIDATION_MESSAGE,
  normalizePersonName,
} from '../user-input-validation';
import { IsRegistrationPhone } from './registration-phone.validator';

export class RegisterUserDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizePersonName(value) : value,
  )
  @IsString()
  @IsNotEmpty({
    message: 'firstName is required',
  })
  @Length(PERSON_NAME_MIN_LENGTH, PERSON_NAME_MAX_LENGTH, {
    message: `firstName must be between ${PERSON_NAME_MIN_LENGTH} and ${PERSON_NAME_MAX_LENGTH} characters`,
  })
  @Matches(PERSON_NAME_PATTERN, {
    message: `firstName ${PERSON_NAME_VALIDATION_MESSAGE}`,
  })
  firstName: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? normalizePersonName(value) : value,
  )
  @IsString()
  @IsNotEmpty({
    message: 'lastName is required',
  })
  @Length(PERSON_NAME_MIN_LENGTH, PERSON_NAME_MAX_LENGTH, {
    message: `lastName must be between ${PERSON_NAME_MIN_LENGTH} and ${PERSON_NAME_MAX_LENGTH} characters`,
  })
  @Matches(PERSON_NAME_PATTERN, {
    message: `lastName ${PERSON_NAME_VALIDATION_MESSAGE}`,
  })
  lastName: string;

  @IsOptional()
  @IsDateString({}, { message: 'dateOfBirth must use YYYY-MM-DD format' })
  dateOfBirth?: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @MaxLength(EMAIL_MAX_LENGTH, {
    message: `email must not exceed ${EMAIL_MAX_LENGTH} characters`,
  })
  @IsEmail({}, { message: 'email must be a valid email address' })
  email: string;

  @IsString({ message: 'User Name must be Value String' })
  @IsOptional()
  username: string;

  @IsString()
  @IsRegistrationPhone({
    message: 'mobile must be a valid phone number for the selected country',
  })
  mobile: string;

  @IsNotEmpty({ message: 'Calling Code is  required' })
  callingCode: string;

  @IsNotEmpty({ message: 'Country Code is  required' })
  countryCode: string;

  @Length(6)
  @IsString()
  password: string;
}

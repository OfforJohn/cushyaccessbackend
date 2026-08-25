import { IsNotEmpty, IsString, IsUrl } from 'class-validator';
import { RegisterUserDto } from './regsiter-user.dto';

export class RegisterThirdPartyDto extends RegisterUserDto {
  @IsNotEmpty({ message: 'CAC URL is required' })
  @IsUrl({}, { message: 'CAC URL must be a valid URL' })
  cacURL: string;

  @IsString({ message: 'businessName must be a string ' })
  @IsNotEmpty({ message: 'businessName is required' })
  businessName: string;
}

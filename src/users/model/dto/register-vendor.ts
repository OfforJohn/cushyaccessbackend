import { Length } from 'class-validator';
import { RegisterUserDto } from './regsiter-user.dto';

export class RegisterVendorDto extends RegisterUserDto {
  @Length(6)
  password: string;
}

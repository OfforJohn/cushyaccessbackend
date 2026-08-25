import { Length } from 'class-validator';

export class PasswordRequest {
  @Length(6)
  password: string;
}

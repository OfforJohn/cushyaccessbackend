import { Length } from 'class-validator';

export class SetPasswordDto {
  @Length(6)
  password: string;
}

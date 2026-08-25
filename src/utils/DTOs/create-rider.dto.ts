import { IsString, IsEmail, IsOptional, IsIn } from 'class-validator';

export class CreateRiderDto {
  @IsString()
  name: string;

  @IsString()
  first_name: string;

  @IsString()
  last_name: string;

  @IsString()
  phone: string;

  @IsEmail()
  email: string;

  @IsIn(['active', 'inactive', 'busy'])
  status: string;

  @IsString()
  vehicle_id: string;
}

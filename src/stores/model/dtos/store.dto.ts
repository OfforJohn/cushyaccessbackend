import { IsNotEmpty, IsOptional } from 'class-validator';

export class StoresDto {
  @IsNotEmpty({ message: 'name is required' })
  name: string;

  @IsOptional()
  description?: string;

  @IsOptional()
  coverImage?: string;

  @IsNotEmpty({ message: 'email is required' })
  email: string;

  @IsNotEmpty({ message: 'mobile is required' })
  mobile: string;

  @IsNotEmpty({ message: 'locationId is required' })
  addressId: string; //Userlocations id
}

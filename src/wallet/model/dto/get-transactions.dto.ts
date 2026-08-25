import { IsNotEmpty, IsString } from 'class-validator';

export class GetTransactionsDto {
  @IsString()
  @IsNotEmpty()
  userId: string;
}

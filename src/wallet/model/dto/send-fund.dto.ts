import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SendFundsDto {
  @IsString()
  @IsOptional()
  senderId?: string;

  @IsString()
  @IsNotEmpty({ message: 'RECIPIENT_ID_REQUIRED' })
  recipientId: string;

  @Type(() => Number)
  @IsInt()
  @Min(400)
  @Max(10_000_000)
  amount: number;

  userIs: 'sender' | 'receipient';
}

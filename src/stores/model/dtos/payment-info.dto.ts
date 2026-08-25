import { IsNotEmpty, Length } from 'class-validator';

export class PaymentInfoRequest {
  @IsNotEmpty({
    message: 'Account name is required',
  })
  accountName: string;

  @Length(10, 10, { message: 'Account number must be 10 digits' })
  accountNumber: string;

  @IsNotEmpty({
    message: 'Bank is required',
  })
  bank: string;
}

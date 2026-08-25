export class VirtualAccountDto {
  constructor(
    private readonly id: string,
    private readonly accountName: string,
    private readonly accountNumber: string,
    private readonly bank: string,
    private readonly createdAt: Date,
    private readonly updatedAt: Date,
  ) {}
}

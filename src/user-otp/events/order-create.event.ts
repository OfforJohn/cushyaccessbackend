export class OrderCreateEvent {
  constructor(
    public readonly recipient: string,
    public readonly orderId: string,
    public readonly deliveryFee: string,
    public readonly orderETA: string,
    public readonly createdAt: string,
    public readonly deliveryAddress: string,
    public readonly items: string,
  ) {}
}

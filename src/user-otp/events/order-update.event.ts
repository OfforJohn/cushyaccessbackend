export class OrderUpdateEvent {
  constructor(
    public readonly recipient: string,
    public readonly orderId: string,
    public readonly orderStatus: string,
    public readonly createdAt: string,
    public readonly deliveryAddress: string,
    public readonly items: string,
  ) {}
}

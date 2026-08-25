export class RiderLocationUpdatedEvent {
    constructor(
        public readonly riderId: string,
        public readonly latitude: number,
        public readonly longitude: number,
        public readonly accuracy?: number,
        public readonly altitude?: number,
        public readonly speed?: number,
        public readonly heading?: number,
        public readonly timestamp: Date = new Date(),
        public readonly batteryLevel?: number,
    ) {}
}
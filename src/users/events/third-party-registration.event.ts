export class ThirdPartyRegistrationEvent {
  constructor(
    public readonly userId: string,
    public readonly cacURL: string,
  ) {}
}

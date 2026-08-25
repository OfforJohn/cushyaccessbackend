export class UserLocationsDto {
  constructor(
    readonly id: string,
    readonly country: string,
    readonly state: string,
    readonly address: string,
    readonly landMark: string,
    readonly latitude: string,
    readonly longitude: string,
    readonly isSupported: boolean,
    readonly city?: string,
    readonly placeId?: string,
  ) {}
}

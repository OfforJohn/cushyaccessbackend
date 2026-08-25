// Example in NestJS
import { Controller, Get, Query } from '@nestjs/common';
import { LocationsService } from './locations.service';

@Controller('/api/v1/common')
export class CommonController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get('/locations')
  async searchLocations(@Query('query') query: string) {
    return await this.locationsService.searchLocations(query);
  }

  @Get('/location-geocode')
  async getLocationsByLatitudeAndLongitude(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
  ) {
    return await this.locationsService.reverseGeocode(latitude, longitude);
  }
}

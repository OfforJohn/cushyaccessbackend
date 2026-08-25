import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { StandardResponse } from './module/standard-response';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LocationsService {
  apiKey = '';
  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get('GOOGLE_MAPS_API_KEY');
  }

  async searchLocations(query: string) {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${this.apiKey}`;
    const res = await axios.get(url);
    return new StandardResponse(
      false,
      'LOCATION_SEARCHED_SUCCESSFULLY',
      res.data?.predictions ?? [],
    );
  }

  async reverseGeocode(lat: string, lng: string) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${this.apiKey}`;
    const res = await axios.get(url);
    return new StandardResponse(
      false,
      'LOCATION_LOOK_UP_SUCCESSFULLY',
      res.data?.results[0]?.formatted_address ?? 'Address not found',
    );
  }
}

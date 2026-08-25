import axios from 'axios';
import { BadRequestException } from '@nestjs/common';
import { StandardResponse } from '../common/module/standard-response';

export class GoogleMapsService {
  private getAddressComponent(
    components: any[],
    types: string[],
  ): string | undefined {
    return types
      .map((type) =>
        components.find((component: any) => component.types.includes(type)),
      )
      .find(Boolean)?.long_name;
  }

  async getPlaceDetails(placeId: string) {
    const response = await axios.get(
      'https://maps.googleapis.com/maps/api/place/details/json',
      {
        params: {
          place_id: placeId,
          fields: 'formatted_address,address_components,geometry',
          key: process.env.GOOGLE_MAPS_API_KEY,
        },
      },
    );
    const result = response.data?.result;
    if (response.data?.status !== 'OK' || !result) {
      throw new Error(
        response.data?.error_message || 'Unable to resolve selected location',
      );
    }

    const components = result.address_components || [];
    const latitude = result.geometry?.location?.lat;
    const longitude = result.geometry?.location?.lng;

    return {
      address: result.formatted_address,
      country: this.getAddressComponent(components, ['country']),
      state: this.getAddressComponent(components, [
        'administrative_area_level_1',
      ]),
      city: this.getAddressComponent(components, [
        'locality',
        'postal_town',
        'administrative_area_level_2',
        'sublocality',
      ]),
      latitude: typeof latitude === 'number' ? String(latitude) : undefined,
      longitude: typeof longitude === 'number' ? String(longitude) : undefined,
      placeId,
    };
  }

  async geocodeAddress(address: string) {
    const normalizedAddress = address?.trim();
    if (!normalizedAddress) {
      throw new BadRequestException(
        new StandardResponse(true, 'INVALID_LOCATION_ADDRESS'),
      );
    }

    const response = await axios.get(
      'https://maps.googleapis.com/maps/api/geocode/json',
      {
        params: {
          address: normalizedAddress,
          key: process.env.GOOGLE_MAPS_API_KEY,
        },
        timeout: 10_000,
      },
    );
    const result = response.data?.results?.[0];
    const latitude = result?.geometry?.location?.lat;
    const longitude = result?.geometry?.location?.lng;
    if (
      response.data?.status !== 'OK' ||
      !result ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      throw new BadRequestException(
        new StandardResponse(true, 'UNABLE_TO_RESOLVE_LOCATION'),
      );
    }

    const components = result.address_components || [];
    return {
      address: result.formatted_address || normalizedAddress,
      country: this.getAddressComponent(components, ['country']),
      state: this.getAddressComponent(components, [
        'administrative_area_level_1',
      ]),
      city: this.getAddressComponent(components, [
        'locality',
        'postal_town',
        'administrative_area_level_2',
        'sublocality',
      ]),
      latitude: String(latitude),
      longitude: String(longitude),
      placeId: result.place_id as string | undefined,
    };
  }

  /**
   * Get detailed location info from latitude and longitude
   * @param latitude
   * @param longitude
   */
  async getLocationDetails(latitude: string, longitude: string) {
    try {
      // Call Google Geocoding API
      const geoResponse = await axios.get(
        `https://maps.googleapis.com/maps/api/geocode/json`,
        {
          params: {
            latlng: `${latitude},${longitude}`,
            key: process.env.GOOGLE_MAPS_API_KEY,
          },
        },
      );

      if (!geoResponse.data.results.length) {
        throw new Error('No results found for the given coordinates.');
      }

      const result = geoResponse.data.results[0];
      const addressComponents = result.address_components;

      // Extract country and state
      const country = addressComponents.find((c: any) =>
        c.types.includes('country'),
      )?.long_name;

      const state = addressComponents.find((c: any) =>
        c.types.includes('administrative_area_level_1'),
      )?.long_name;

      const city = this.getAddressComponent(addressComponents, [
        'locality',
        'postal_town',
        'administrative_area_level_2',
        'sublocality',
      ]);

      const fullAddress = result.formatted_address;

      // Call Places API nearby search for landmark
      const placesResponse = await axios.get(
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json`,
        {
          params: {
            location: `${latitude},${longitude}`,
            radius: 200, // meters
            key: process.env.GOOGLE_MAPS_API_KEY,
          },
        },
      );

      let landmark = null;
      if (placesResponse.data.results.length > 0) {
        landmark = placesResponse.data.results[0].name;
      }

      return {
        country,
        state,
        city,
        address: fullAddress,
        landmark,
      };
    } catch (error: any) {
      throw new Error(
        `Error fetching location details: ${error.response?.data?.error_message || error.message}`,
      );
    }
  }
}

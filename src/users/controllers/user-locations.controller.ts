import {
  Controller,
  Post,
  Put,
  Delete,
  Get,
  Param,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { UserLocationsService } from '../services/user-locations.service';
import { CreateLocationRequest } from '../model/dto/create-location-request';
import { StandardResponse } from '../../common/module/standard-response';
import { Public } from '../../auth/service/public.decorator';
import { Permit } from '../../auth/service/roles.decorator';
import { UserRoles } from '../model/user-roles.enum';
import { CommonService } from 'src/common/common.service';
import { UpdateLocationDto } from '../model/dto/update-location-dto';

@Controller('api/v1/user-locations')
export class UserLocationsController {
  constructor(
    private readonly userLocationsService: UserLocationsService,
    private readonly commonsService: CommonService,
  ) {}

  @Permit([UserRoles.ADMIN])
  @Post()
  async createLocation(
    @Body() createLocationRequest: CreateLocationRequest,
  ): Promise<StandardResponse> {
    return this.userLocationsService.createLocation(createLocationRequest);
  }

  @Permit([UserRoles.ADMIN])
  @Put(':id')
  async updateLocation(
    @Param('id') id: string,
    @Body() updateLocationRequest: CreateLocationRequest,
  ): Promise<StandardResponse> {
    return this.userLocationsService.updateLocation(id, updateLocationRequest);
  }

  @Permit([UserRoles.ADMIN])
  @Delete(':id')
  async deleteLocation(@Param('id') id: string): Promise<StandardResponse> {
    return this.userLocationsService.deleteLocation(id);
  }

  @Public()
  @Get()
  async getLocations(@Query('query') query: string): Promise<StandardResponse> {
    return this.userLocationsService.getLocations(query);
  }

  @Permit([UserRoles.CUSTOMER, UserRoles.VENDOR])
  @Post('update-user-location')
  async updateUserLocation(
    @Body() payload: UpdateLocationDto,
  ): Promise<StandardResponse> {
    const loggedInUser = await this.commonsService.getLoggedInUser(); // Assuming request.user.role is available from @Permit or auth guard

    if (!payload.country || !payload.state || !payload.address) {
      throw new BadRequestException(
        new StandardResponse(true, 'Missing required location fields'),
      );
    }

    const locationPayload = {
      country: payload.country,
      state: payload.state,
      city: payload.city,
      address: payload.address,
      latitude: payload.latitude,
      longitude: payload.longitude,
      placeId: payload.placeId,
    };

    if (
      payload.type === 'VENDOR' ||
      loggedInUser.userRole === UserRoles.VENDOR
    ) {
      return this.userLocationsService.updateVendorLocation(locationPayload);
    } else if (
      payload.type === 'CUSTOMER' ||
      loggedInUser.userRole === UserRoles.CUSTOMER ||
      loggedInUser.userRole === UserRoles.ADMIN ||
      loggedInUser.userRole === UserRoles.THIRD_PARTY
    ) {
      return this.userLocationsService.updateUserLocation(locationPayload);
    } else {
      throw new BadRequestException(
        new StandardResponse(true, 'Invalid user role for location update'),
      );
    }
  }

  @Permit([UserRoles.ADMIN])
  @Post('batch-normalization')
  async batchNormalizeHistoricalStates(): Promise<StandardResponse> {
    return this.userLocationsService.batchNormalizeHistoricalStates();
  }
}

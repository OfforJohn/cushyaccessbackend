import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { UsersService } from '../services/users.service';
import { Request } from 'express';
import { PasswordRequest } from '../model/dto/password-request';
import { Users } from '../model/users.entity';
import { UsersDetailsService } from '../services/user-details.service';
import { Permit } from 'src/auth/service/roles.decorator';
import { UserRoles } from '../model/user-roles.enum';
import { SkipThrottle } from '@nestjs/throttler';
import { UpdateBirthdayDto } from '../model/dto/update-birthday.dto';
import { StandardResponse } from 'src/common/module/standard-response';
import { DailyReminderPreferenceDto } from '../model/dto/daily-reminder-preference.dto';
import { DailyReminderPreferenceService } from '../services/daily-reminder-preference.service';

@Controller('api/v1/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly userDetailsService: UsersDetailsService,
    private readonly dailyReminderPreferenceService: DailyReminderPreferenceService,
  ) {}

  @Get('/me')
  async getProfile() {
    return await this.userDetailsService.getUserDetails();
  }
  @SkipThrottle()
  @Get('/info/:id')
  async getUserById(@Param('id') id: string) {
    return await this.usersService.getUserDetails(id);
  }

  @Patch('/location/:locationId')
  async updateLocation(@Param('locationId') locationId: string) {
    return await this.userDetailsService.setLocation(locationId);
  }


  @Patch('/profile-pic')
  async updateProfilePic(@Body('profilePic') profilePic: string) {
    return await this.userDetailsService.setProfilePic(profilePic);
  }

  @Patch('/birthday')
  async updateBirthday(
    @Req() req: Request & { user: Users },
    @Body() payload: UpdateBirthdayDto,
  ) {
    const data = await this.usersService.updateDateOfBirth(
      req.user.id,
      payload.dateOfBirth,
    );
    return new StandardResponse(
      false,
      'BIRTHDAY_UPDATED_SUCCESSFULLY',
      data,
    );
  }

  @Get('/me/daily-reminder')
  async getDailyReminderPreference(@Req() req: Request & { user: Users }) {
    return await this.dailyReminderPreferenceService.getPreference(req.user.id);
  }

  @Patch('/me/daily-reminder')
  async updateDailyReminderPreference(
    @Req() req: Request & { user: Users },
    @Body() preference: DailyReminderPreferenceDto,
  ) {
    return await this.dailyReminderPreferenceService.updatePreference(
      req.user.id,
      preference,
    );
  }

  @Put('/vendor/payout-details')
  async updateVendorPayoutDetails(@Body() payload: any) {
    return await this.userDetailsService.updateVendorPayoutDetails(payload);
  }
  @Get('get-vendor/payout-details')
  async getVendorPayoutDetails() {
    return await this.userDetailsService.getVendorPayoutDetails();
  }

  @Put('set-password-onboarding')
  async setPassword(
    @Req() req: Request & { user: Users },
    @Body() passwordRequest: PasswordRequest,
  ) {
    const user = req.user;
    return await this.usersService.setPassword(
      passwordRequest.password,
      user,
    );
  }

  @Post('verify-vendor')
  @Permit([UserRoles.ADMIN])
  async verifyVendor(@Query('userId') userId: string) {
    return await this.usersService.verifyVendor(userId);
  }

  @Post('unverify-vendor')
  @Permit([UserRoles.ADMIN])
  async unVerifyVendor(@Query('userId') userId: string) {
    return await this.usersService.unVerifyVendor(userId);
  }
}

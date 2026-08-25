import { Controller, Post, Put, Patch, Body, Param, Get } from '@nestjs/common';
import { UserCredentialsService } from '../services/user-credential.service';
import { CreateCredentialDTO } from '../model/dto/create-credential.dto';
import { UserCredentialStatus } from '../model/user-credential.enum';
import { UserRoles } from '../model/user-roles.enum';
import { Permit } from 'src/auth/service/roles.decorator';

@Controller('api/v1/user-credentials')
export class UserCredentialsController {
  constructor(
    private readonly userCredentialsService: UserCredentialsService,
  ) {}

  @Post()
  @Permit([UserRoles.VENDOR, UserRoles.DOCTOR])
  async create(@Body() dto: CreateCredentialDTO) {
    return await this.userCredentialsService.create(dto);
  }

  @Put()
  async update(@Body() dto: CreateCredentialDTO) {
    return this.userCredentialsService.update(dto);
  }

  @Patch('/status')
  @Permit([UserRoles.ADMIN])
  async updateStatus(@Body('status') status: UserCredentialStatus) {
    return this.userCredentialsService.updateStatus(status);
  }

  @Post(':userId/validate')
  async validateCredentials(@Param('userId') userId: string) {
    return this.userCredentialsService.validateCredentials(userId);
  }

  @Get()
  async getCredential() {
    return this.userCredentialsService.getUserCredentials();
  }
}

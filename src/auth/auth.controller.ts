import { Controller, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { AuthService } from './service/auth.service';
import { RegisterUserDto } from 'src/users/model/dto/regsiter-user.dto';
import { Public } from './service/public.decorator';
import { AuthRequestDto } from './dto/auth-request.dto';
import { OtpRequestDto } from './dto/otp-request.dto';
import { PasswordRequestDto } from './dto/password-request.dto';
import { PasswordResetRequest } from './dto/password-reset-request.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RegisterThirdPartyDto } from '../users/model/dto/regsiter-third-party.dto';
import { ApiKeyRequest } from './dto/api-key-request.dto';
import { CreateProfessionDetailsDto } from './dto/profession-details.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { RegisterRiderDto } from 'src/users/model/register-rider.dto';
import { VerifyPasswordOtpDto } from './dto/verify-password-otp.dto';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Public()
  @Post('signup/:role')
  async register(
    @Body() registerUserDTO: RegisterUserDto,
    @Param('role') role: string,
    @Body() professionalDetails?: CreateProfessionDetailsDto,
    @Body() riderDetails?: RegisterRiderDto
  ) {
    return this.authService.register(registerUserDTO, role, professionalDetails, riderDetails);
  }

  @Public()
  @Post('signup-third-party')
  async registerThirdPartyUser(
    @Body() registerThirdParty: RegisterThirdPartyDto,
  ) {
    return this.authService.registerThirdParty(registerThirdParty);
  }

  @Public()
  @Post('authenticate')
  @SkipThrottle()
  async authenticateThirdParty(@Body() apiKeyRequest: ApiKeyRequest) {
    return this.authService.loginThirdParty(apiKeyRequest);
  }

  @Public()
  @Post('login')
  @SkipThrottle()
  async login(@Body() authRequest: AuthRequestDto) {
    return this.authService.login(authRequest);
  }

  @Public()
  @Post('mobile-app/login')
  @SkipThrottle()
  async loginMobileApp(@Body() authRequest: AuthRequestDto) {
    return this.authService.loginMobileApp(authRequest);
  }

  @Public()
  @Post('rider-app/login')
  @SkipThrottle()
  async loginRiderApp(@Body() authRequest: AuthRequestDto) {
    return this.authService.loginRiderApp(authRequest);
  }

  @Post('send-otp')
  @SkipThrottle()
  async sendOTP(@Body() otpRequestDto: OtpRequestDto) {
    return await this.authService.sendVerificationOTP(otpRequestDto);
  }

  @Patch('verify-otp')
  @SkipThrottle()
  async verifyOTP(@Body() otpRequestDto: OtpRequestDto) {
    return await this.authService.verifyOTP(otpRequestDto);
  }

  @Public()
  @Post('send-password-otp')
  async sendPasswordResetOTP(
    @Body() passwordResetRequestDto: PasswordResetRequest,
  ) {
    return await this.authService.sendPasswordResetOTP(passwordResetRequestDto);
  }

  @Public()
  @Patch('verify-password-otp')
  async verifyPasswordResetOTP(@Body() dto: VerifyPasswordOtpDto) {
    return this.authService.verifyPasswordResetOTP(dto);
  }

  @Public()
  @Patch('reset-password')
  async resetPassword(@Body() passwodResetDto: PasswordRequestDto) {
    return await this.authService.verifyAndResetPassword(passwodResetDto);
  }

  @Post('change-password')
  @SkipThrottle()
  async changePassword(@Body() changePasswordDto: ChangePasswordDto) {
    return await this.authService.changePassword(changePasswordDto);
  }

  @Delete('delete-user')
  async deleteUser() {
    return await this.authService.deleteUser();
  }

  // Admin Login 2FA - Step 1: Validate credentials and send OTP
  @Public()
  @Post('admin/login')
  @SkipThrottle()
  async adminLogin(@Body() adminLoginDto: { email: string; password: string }) {
    return this.authService.adminLoginStep1(adminLoginDto.email, adminLoginDto.password);
  }

  // Admin Login 2FA - Step 2: Verify OTP and complete login
  @Public()
  @Post('admin/verify-login')
  @SkipThrottle()
  async adminVerifyLogin(@Body() verifyDto: { email: string; otp: string; loginToken: string }) {
    return this.authService.adminLoginStep2(verifyDto.email, verifyDto.otp, verifyDto.loginToken);
  }
}

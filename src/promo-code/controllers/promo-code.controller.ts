import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Put,
  Delete,
  Query,
  Patch,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PromoCodeService } from '../service/promo-code.service';
import { CreatePromoCodeDto } from '../dto/create-promo-code.dto';
import { PaginationRequest } from 'src/common/module/pagination-request';
import { UpdatePromoCodeDto } from '../dto/update-promo-code.dto';
import { StandardResponse } from 'src/common/module/standard-response';
import { CreateCouponDto } from '../dto/create-coupon.dto';
import { Permit } from 'src/auth/service/roles.decorator';
import { UserRoles } from 'src/users/model/user-roles.enum';

@Controller('api/v1/promo-code')
export class PromoCodeController {
  constructor(private readonly promoCodeService: PromoCodeService) {}

  @Post()
  async create(@Body() dto: CreatePromoCodeDto) {
    return this.promoCodeService.createPromoCode(dto);
  }
  @Get()
  async getPrromoCodes(@Query() paginationRequest: PaginationRequest) {
    return this.promoCodeService.getPromoCodes(paginationRequest);
  }

  @Permit([UserRoles.ADMIN])
  @Get('get-all-coupon')
  async getAllCoupon() {
    return this.promoCodeService.getAllCoupon();
  }

  @Permit([UserRoles.ADMIN])
  @Get('birthday-analytics')
  async getBirthdayAnalytics(
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('search') search?: string,
    @Query('usage') usage?: 'used' | 'unused',
  ) {
    return this.promoCodeService.getBirthdayRewardAnalytics({
      page: Number(page) || 1,
      size: Number(size) || 25,
      search,
      usage,
    });
  }

  @Get(':idOrCode')
  async get(@Param('idOrCode') idOrCode: string) {
    return this.promoCodeService.getPromoCode(idOrCode);
  }

  @Put(':idOrCode')
  async update(@Param('idOrCode') id: string, @Body() dto: UpdatePromoCodeDto) {
    return this.promoCodeService.updatePromoCode(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.promoCodeService.deletePromoCode(id);
  }

  @Post('validate/:codeValue/:userId')
  async validate(
    @Param('codeValue') codeValue: string,
    @Param('userId') userId: string,
  ) {
    return new StandardResponse(
      false,
      'PROMO_CODE_VALIDATION',
      await this.promoCodeService.validatePromoCode(codeValue, userId),
    );
  }

  @Permit([UserRoles.ADMIN])
  @Post('create-coupon')
  async createCoupon(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: CreateCouponDto,
  ) {
    return this.promoCodeService.createCoupon(dto, req.user.id);
  }

  @Permit([UserRoles.ADMIN])
  @Patch('deactivate/:id')
  async deactivateCoupon(@Param('id') id: string) {
    return this.promoCodeService.deactivateCoupon(id);
  }

  @Permit([UserRoles.ADMIN])
  @Delete('coupon/:id')
  async deleteCoupon(@Param('id') id: string) {
    return this.promoCodeService.deleteCoupon(id);
  }

  @Get('validate/:code')
  async validateCoupon(
    @Param('code') code: string,
    @Query('storeId') storeId?: string,
    @Query('userId') userId?: string,
  ) {
    return this.promoCodeService.validateCoupon(code, storeId, userId);
  }
}

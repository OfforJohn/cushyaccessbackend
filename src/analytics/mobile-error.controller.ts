import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommonService } from '../common/common.service';
import { ReportMobileErrorDto } from './dto/report-mobile-error.dto';
import { MobileErrorReport } from './entities/mobile-error-report.entity';

@Controller('api/v1/mobile-errors')
export class MobileErrorController {
  constructor(
    @InjectRepository(MobileErrorReport)
    private readonly reports: Repository<MobileErrorReport>,
    private readonly commonService: CommonService,
  ) {}

  @Post()
  @HttpCode(202)
  async report(@Body() dto: ReportMobileErrorDto) {
    const user = await this.commonService.getLoggedInUser();
    const report = this.reports.create({ userId: user.id, ...dto });
    const saved = await this.reports.save(report);
    return { accepted: true, id: saved.id };
  }
}

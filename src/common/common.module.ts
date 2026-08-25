import { Module } from '@nestjs/common';
import { CommonService } from './common.service';
import { CommonController } from './common.controller';
import { LocationsService } from './locations.service';

@Module({
  providers: [CommonService, LocationsService],
  exports: [CommonService],
  controllers: [CommonController],
})
export class CommonModule {}

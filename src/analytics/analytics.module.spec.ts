import { MODULE_METADATA } from '@nestjs/common/constants';
import { CommonModule } from '../common/common.module';
import { CommonService } from '../common/common.service';
import { AnalyticsModule } from './analytics.module';

describe('AnalyticsModule', () => {
  it('imports CommonModule so MobileErrorController can inject CommonService', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AnalyticsModule,
    ) as unknown[];

    expect(imports).toContain(CommonModule);
  });

  it('uses a CommonModule that exports CommonService', () => {
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      CommonModule,
    ) as unknown[];

    expect(exports).toContain(CommonService);
  });
});

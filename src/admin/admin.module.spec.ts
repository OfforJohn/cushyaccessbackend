jest.mock('@nestjs/platform-express', () => ({
  FileFieldsInterceptor: jest.fn(() => class FileFieldsInterceptorMock {}),
  FilesInterceptor: jest.fn(() => class FilesInterceptorMock {}),
}));

import { MODULE_METADATA } from '@nestjs/common/constants';
import { AdminModule } from './admin.module';
import { StoresModule } from '../stores/stores.module';
import { StoreService } from '../stores/services/stores.service';
import { UserOtpModule } from '../user-otp/user-otp.module';
import { MailSenderService } from '../user-otp/mail-sender.service';
import { MobileSenderService } from '../user-otp/mobile-sender.service';

describe('AdminModule', () => {
  it('reuses the StoreService exported by StoresModule', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AdminModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AdminModule,
    ) as unknown[];

    expect(imports).toContain(StoresModule);
    expect(imports).toContain(UserOtpModule);
    expect(providers).not.toContain(StoreService);
    expect(providers).not.toContain(MailSenderService);
    expect(providers).not.toContain(MobileSenderService);
  });
});

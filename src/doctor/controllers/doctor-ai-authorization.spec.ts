import { ROLE_KEY } from '../../auth/service/roles.decorator';
import { UserRoles } from '../../users/model/user-roles.enum';
import { DoctorController } from './doctor.controller';

jest.mock('@nestjs/platform-express', () => ({
  FileFieldsInterceptor: jest.fn(() => class MockInterceptor {}),
  FileInterceptor: jest.fn(() => class MockInterceptor {}),
}));

describe('DoctorController AI route authorization', () => {
  it('keeps health triage customer-only', () => {
    expect(
      Reflect.getMetadata(ROLE_KEY, DoctorController.prototype.findDoctor),
    ).toEqual([UserRoles.CUSTOMER]);
  });
});

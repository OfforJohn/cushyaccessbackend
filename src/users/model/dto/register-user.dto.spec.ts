import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterUserDto } from './regsiter-user.dto';

const validRegistration = {
  firstName: 'Ada',
  lastName: "Nwankwo-O'Neil",
  email: 'ADA@example.com',
  mobile: '8012345678',
  callingCode: '234',
  countryCode: 'NG',
  password: 'secret1',
};

describe('RegisterUserDto identity validation', () => {
  it('normalizes and accepts valid international names and email', async () => {
    const dto = plainToInstance(RegisterUserDto, {
      ...validRegistration,
      firstName: '  Ada\u0301  ',
      email: '  ADA@example.com  ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.firstName).toBe('Ad\u00e1');
    expect(dto.email).toBe('ada@example.com');
  });

  it.each(['Ada123', 'Ada@#$%', 'A'.repeat(51)])(
    'rejects invalid first name %s',
    async (firstName) => {
      const dto = plainToInstance(RegisterUserDto, {
        ...validRegistration,
        firstName,
      });

      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'firstName')).toBe(true);
    },
  );

  it.each([
    'broken-address',
    'a..b@example.com',
    '.name@example.com',
    'name@example..com',
    'name@example.c',
    'user@-example.com',
  ])('rejects invalid email %s', async (email) => {
    const dto = plainToInstance(RegisterUserDto, {
      ...validRegistration,
      email,
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'email')).toBe(true);
  });

  it.each(['8012345678', '08012345678', '+234 801 234 5678'])(
    'accepts Nigerian phone form %s',
    async (mobile) => {
      const dto = plainToInstance(RegisterUserDto, {
        ...validRegistration,
        mobile,
      });

      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'mobile')).toBe(false);
    },
  );

  it('accepts a valid non-Nigerian national number', async () => {
    const dto = plainToInstance(RegisterUserDto, {
      ...validRegistration,
      mobile: '4155552671',
      callingCode: '1',
      countryCode: 'US',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'mobile')).toBe(false);
  });

  it('does not strip a local number merely because it starts with its calling code', async () => {
    const dto = plainToInstance(RegisterUserDto, {
      ...validRegistration,
      mobile: '3931234567',
      callingCode: '39',
      countryCode: 'IT',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'mobile')).toBe(false);
  });

  it('accepts the legacy territory dial-prefix shape while new clients use the E.164 root', async () => {
    const dto = plainToInstance(RegisterUserDto, {
      ...validRegistration,
      mobile: '3651234',
      callingCode: '1242',
      countryCode: 'BS',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'mobile')).toBe(false);
  });

  it('rejects a number that belongs to a different selected country', async () => {
    const dto = plainToInstance(RegisterUserDto, {
      ...validRegistration,
      mobile: '+14155552671',
      callingCode: '44',
      countryCode: 'GB',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'mobile')).toBe(true);
  });

  it.each(['1234567890', '0801234567', '080123456789', 'abc8012345678'])(
    'rejects invalid Nigerian phone form %s',
    async (mobile) => {
      const dto = plainToInstance(RegisterUserDto, {
        ...validRegistration,
        mobile,
      });

      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'mobile')).toBe(true);
    },
  );
});

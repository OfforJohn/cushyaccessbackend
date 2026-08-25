import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { normalizeRegistrationPhone } from '../../services/user-identifier';

type RegistrationPhoneContext = {
  callingCode?: unknown;
  countryCode?: unknown;
};

export const isValidRegistrationPhone = (
  value: unknown,
  context: RegistrationPhoneContext,
): boolean => {
  return (
    typeof value === 'string' &&
    Boolean(
      normalizeRegistrationPhone(
        value,
        String(context.callingCode ?? ''),
        String(context.countryCode ?? ''),
      ),
    )
  );
};

export const IsRegistrationPhone =
  (validationOptions?: ValidationOptions): PropertyDecorator =>
  (target, propertyKey) => {
    registerDecorator({
      name: 'isRegistrationPhone',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      options: validationOptions,
      validator: {
        validate(value: unknown, arguments_: ValidationArguments) {
          return isValidRegistrationPhone(
            value,
            arguments_.object as RegistrationPhoneContext,
          );
        },
      },
    });
  };

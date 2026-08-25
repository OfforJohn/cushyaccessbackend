import {
  CountryCode,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';

export const normalizeRegistrationPhone = (
  value: string,
  callingCode: string,
  countryCode: string,
): string | undefined => {
  const input = value.trim();
  const code = callingCode.replace(/\D/g, '');
  const country = countryCode.trim().toUpperCase();
  if (!input || !/^\+?[\d\s()-]+$/.test(input) || !/^[A-Z]{2}$/.test(country)) {
    return undefined;
  }

  if (country === 'NG' && code === '234') {
    let nationalNumber = input.replace(/\D/g, '');
    if (input.startsWith('00')) nationalNumber = nationalNumber.slice(2);
    if (nationalNumber.length === 13 && nationalNumber.startsWith('234')) {
      nationalNumber = nationalNumber.slice(3);
    }
    if (nationalNumber.length === 11 && nationalNumber.startsWith('0')) {
      nationalNumber = nationalNumber.slice(1);
    }
    return /^[789]\d{9}$/.test(nationalNumber) ? nationalNumber : undefined;
  }

  try {
    const selectedCountry = country as CountryCode;
    const expectedCode = getCountryCallingCode(selectedCountry);
    const isLegacyTerritoryPrefix =
      code.startsWith(expectedCode) && code.length <= 4;
    if (code !== expectedCode && !isLegacyTerritoryPrefix) return undefined;
    const parseableInput = input.startsWith('00')
      ? `+${input.slice(2)}`
      : input;
    const phone = parsePhoneNumberFromString(parseableInput, selectedCountry);
    if (
      !phone?.isValid() ||
      phone.country !== selectedCountry ||
      phone.countryCallingCode !== expectedCode
    ) {
      return undefined;
    }
    return phone.nationalNumber;
  } catch {
    return undefined;
  }
};

export const getNormalizedCountryCallingCode = (
  countryCode: string,
): string | undefined => {
  try {
    return getCountryCallingCode(
      countryCode.trim().toUpperCase() as CountryCode,
    );
  } catch {
    return undefined;
  }
};

export const getPhoneCandidates = (
  value: string,
  callingCode = '234',
  countryCode = callingCode.replace(/\D/g, '') === '234' ? 'NG' : '',
): string[] => {
  const digits = value.replace(/\D/g, '');
  const candidates = new Set<string>();
  const add = (candidate: string) => {
    if (candidate) candidates.add(candidate);
  };

  const code = callingCode.replace(/\D/g, '');
  const nationalNumber = countryCode
    ? normalizeRegistrationPhone(value, code, countryCode)
    : undefined;
  const normalized =
    nationalNumber || normalizeStoredPhone(value, code, countryCode);

  add(digits);
  add(normalized);
  if (normalized) {
    add(`${code}${normalized}`);
    if (!normalized.startsWith('0')) add(`0${normalized}`);
  }

  return [...candidates];
};

export const normalizeStoredPhone = (
  value: string,
  callingCode: string,
  countryCode = '',
): string => {
  const parsed = countryCode
    ? normalizeRegistrationPhone(value, callingCode, countryCode)
    : undefined;
  if (parsed) return parsed;

  const original = value.trim();
  let digits = value.replace(/\D/g, '');
  const code = callingCode.replace(/\D/g, '');
  const hasExplicitInternationalPrefix =
    original.startsWith('+') || original.startsWith('00');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (
    code &&
    digits.startsWith(code) &&
    (hasExplicitInternationalPrefix || code === '234')
  ) {
    digits = digits.slice(code.length);
  }
  return code === '234' ? digits.replace(/^0+/, '') : digits;
};

export const getCanonicalPhoneIdentity = (
  value: string,
  callingCode: string,
  countryCode = '',
): string => {
  const code = callingCode.replace(/\D/g, '');
  const nationalNumber = normalizeStoredPhone(value, code, countryCode);
  return code && nationalNumber ? `${code}${nationalNumber}` : '';
};

export const getLoginPhoneIdentities = (value: string): string[] => {
  const trimmed = value.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return [];

  const hasExplicitInternationalPrefix =
    trimmed.startsWith('+') || trimmed.startsWith('00');
  if (digits.startsWith('00')) digits = digits.slice(2);

  if (hasExplicitInternationalPrefix) return [digits];
  if (digits.startsWith('234') && digits.length === 13) return [digits];

  // Unprefixed phone login remains backwards-compatible with the app's
  // Nigerian default. Other countries must include +<calling code>.
  return [`234${digits.replace(/^0+/, '')}`];
};

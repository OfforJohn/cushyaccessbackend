export const PERSON_NAME_MIN_LENGTH = 1;
export const PERSON_NAME_MAX_LENGTH = 50;
export const EMAIL_MAX_LENGTH = 254;

// Human names may contain Unicode letters and common separators, but never
// digits or arbitrary punctuation. Separators must occur between name parts.
export const PERSON_NAME_PATTERN = /^\p{L}+(?:[ '\u2019-]\p{L}+)*$/u;

export const PERSON_NAME_VALIDATION_MESSAGE =
  'must contain only letters, spaces, apostrophes, and hyphens';

export const normalizePersonName = (value: string): string =>
  value.trim().normalize('NFC');

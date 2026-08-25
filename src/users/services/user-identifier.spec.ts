import {
  getCanonicalPhoneIdentity,
  getLoginPhoneIdentities,
  getPhoneCandidates,
  normalizeStoredPhone,
} from './user-identifier';

describe('user identifier normalization', () => {
  it.each([
    ['+234 801 234 5678', '8012345678'],
    ['2348012345678', '8012345678'],
    ['0801-234-5678', '8012345678'],
    ['8012345678', '8012345678'],
  ])('maps %s to the stored local phone form', (input, storedPhone) => {
    expect(getPhoneCandidates(input)).toContain(storedPhone);
  });

  it('returns no phone candidates for malformed input', () => {
    expect(getPhoneCandidates('not-a-phone')).toEqual([]);
  });

  it.each([
    ['0801-234-5678', '234', '8012345678'],
    ['+2348012345678', '+234', '8012345678'],
    ['+14155552671', '1', '4155552671'],
  ])('normalizes %s using calling code %s', (input, callingCode, expected) => {
    expect(normalizeStoredPhone(input, callingCode)).toBe(expected);
  });

  it.each([
    ['08012345678', '234', '2348012345678'],
    ['+2348012345678', '234', '2348012345678'],
    ['4155552671', '1', '14155552671'],
  ])('builds canonical identity for %s', (input, code, expected) => {
    expect(getCanonicalPhoneIdentity(input, code)).toBe(expected);
  });

  it.each([
    ['08012345678', ['2348012345678']],
    ['8012345678', ['2348012345678']],
    ['2348012345678', ['2348012345678']],
    ['+14155552671', ['14155552671']],
    ['0014155552671', ['14155552671']],
  ])('derives unambiguous login identity for %s', (input, expected) => {
    expect(getLoginPhoneIdentities(input)).toEqual(expected);
  });
});

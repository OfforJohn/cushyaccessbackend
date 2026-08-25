import { validate } from 'class-validator';
import { FindDoctorsDto } from './find-doctors.dto';

describe('FindDoctorsDto', () => {
  it('rejects non-string and oversized symptom payloads', async () => {
    const invalidType = Object.assign(new FindDoctorsDto(), { symptoms: 123 });
    const oversized = Object.assign(new FindDoctorsDto(), {
      symptoms: 'x'.repeat(2001),
    });

    await expect(validate(invalidType)).resolves.not.toHaveLength(0);
    await expect(validate(oversized)).resolves.not.toHaveLength(0);
  });

  it('accepts a bounded symptom description', async () => {
    const dto = Object.assign(new FindDoctorsDto(), {
      symptoms: 'Persistent headache since this morning',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});

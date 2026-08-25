import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReportRiderIssueDto } from './report-rider-issue.dto';

describe('ReportRiderIssueDto', () => {
  it('trims category and description before validating their lengths', async () => {
    const dto = plainToInstance(ReportRiderIssueDto, {
      category: '  Wrong address  ',
      description: '  The map pin does not match the supplied address.  ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.category).toBe('Wrong address');
    expect(dto.description).toBe(
      'The map pin does not match the supplied address.',
    );
  });

  it('rejects whitespace-padded values that are too short after trimming', async () => {
    const dto = plainToInstance(ReportRiderIssueDto, {
      category: '  x  ',
      description: '          x          ',
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['category', 'description']),
    );
  });
});

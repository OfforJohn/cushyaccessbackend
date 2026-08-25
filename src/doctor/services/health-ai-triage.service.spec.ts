import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AiProvider } from '../../cushy-ai/model/ai.types';
import { ConsultationType } from '../models/enums/consultation-type.enum';
import { HealthAiTriageService } from './health-ai-triage.service';

describe('HealthAiTriageService', () => {
  const generate = jest.fn();
  const provider = { name: 'test', generate } as unknown as AiProvider;
  const service = new HealthAiTriageService(provider);

  beforeEach(() => generate.mockReset());

  it('returns a validated provider-neutral triage result', async () => {
    generate.mockResolvedValue({
      stopReason: 'tool_use',
      content: [
        {
          type: 'tool_call',
          id: 'call-1',
          name: 'submit_health_triage',
          input: {
            consultationType: ConsultationType.DERMATOLOGIST,
            urgency: 'medium',
            confidence: 0.91,
            reasoning: 'Skin symptoms require dermatology routing.',
          },
        },
      ],
    });

    await expect(service.analyze('I have an itchy skin rash')).resolves.toEqual(
      {
        consultationType: ConsultationType.DERMATOLOGIST,
        specialty: 'Dermatologist',
        urgency: 'medium',
        confidence: 0.91,
        reasoning: 'Skin symptoms require dermatology routing.',
      },
    );
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0,
        maxTokens: 400,
        toolChoice: 'required',
      }),
    );
  });

  it('escalates deterministic emergency red flags even if the model misses them', async () => {
    generate.mockResolvedValue({
      stopReason: 'tool_use',
      content: [
        {
          type: 'tool_call',
          id: 'call-2',
          name: 'submit_health_triage',
          input: {
            consultationType: ConsultationType.GENERAL_PRACTITIONER,
            urgency: 'low',
            confidence: 0.7,
            reasoning: 'General assessment is appropriate.',
          },
        },
      ],
    });

    const result = await service.analyze(
      'I have chest pain and cannot breathe',
    );
    expect(result.urgency).toBe('emergency');
  });

  it('rejects oversized input before sending anything to a provider', async () => {
    await expect(service.analyze('x'.repeat(2001))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects prose or malformed model output instead of trusting it', async () => {
    generate.mockResolvedValue({
      stopReason: 'end_turn',
      content: [{ type: 'text', text: 'See a doctor.' }],
    });

    await expect(service.analyze('headache')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('preserves deterministic emergency escalation when the provider is unavailable', async () => {
    generate.mockRejectedValue(new Error('provider unavailable'));

    const result = await service.analyze(
      'I have chest pain and cannot breathe',
    );

    expect(result).toEqual(
      expect.objectContaining({
        consultationType: ConsultationType.GENERAL_PRACTITIONER,
        urgency: 'emergency',
        confidence: 0,
      }),
    );
  });

  it('falls back to general clinical routing when the provider is unavailable', async () => {
    generate.mockRejectedValue(new Error('provider unavailable'));

    await expect(service.analyze('persistent headache')).resolves.toEqual(
      expect.objectContaining({
        consultationType: ConsultationType.GENERAL_PRACTITIONER,
        urgency: 'medium',
        confidence: 0,
      }),
    );
  });
});

import {
  DEFAULT_BEDROCK_MODEL_ID,
  resolveBedrockModelId,
} from './bedrock-ai.provider';

describe('resolveBedrockModelId', () => {
  it.each([undefined, '', 'openai.gpt-oss-safeguard-120b'])(
    'uses the general conversational model for %p',
    (configured) => {
      expect(resolveBedrockModelId(configured)).toBe(DEFAULT_BEDROCK_MODEL_ID);
    },
  );

  it('preserves an explicitly configured conversational model', () => {
    expect(resolveBedrockModelId('custom.model-v1')).toBe('custom.model-v1');
  });
});

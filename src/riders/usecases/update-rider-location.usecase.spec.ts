import { UpdateRiderLocationUseCase } from './update-rider-location.usecase';

describe('UpdateRiderLocationUseCase location validation', () => {
  const useCase = new UpdateRiderLocationUseCase(
    {} as never,
    {} as never,
    {} as never,
  );
  const validate = (payload: Record<string, number>) =>
    (useCase as any).validateLocationData(payload);

  it('accepts legitimate coarse mobile-network accuracy', () => {
    expect(() =>
      validate({ latitude: 9.0153, longitude: 7.4731, accuracy: 850 }),
    ).not.toThrow();
  });

  it('still rejects unreasonable accuracy values', () => {
    expect(() =>
      validate({ latitude: 9.0153, longitude: 7.4731, accuracy: 100_001 }),
    ).toThrow('INVALID_ACCURACY');
  });
});

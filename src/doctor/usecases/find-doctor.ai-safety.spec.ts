import { ConsultationType } from '../models/enums/consultation-type.enum';
import { FindDoctorUseCase } from './find-doctor.usecase';

describe('FindDoctorUseCase AI safety', () => {
  it('does not create consultation requests for emergency red flags', async () => {
    const commonService = {
      getLoggedInUser: jest.fn().mockResolvedValue({
        id: 'patient_1',
        firstName: 'Ada',
        lastName: 'User',
      }),
    };
    const appointmentRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      save: jest.fn(),
    };
    const triage = {
      analyze: jest.fn().mockResolvedValue({
        consultationType: ConsultationType.GENERAL_PRACTITIONER,
        specialty: 'General Practitioner',
        urgency: 'emergency',
        confidence: 0.95,
        reasoning: 'Emergency red flags detected.',
      }),
    };
    const dataSource = { createQueryRunner: jest.fn() };
    const service = new FindDoctorUseCase(
      commonService as any,
      { publish: jest.fn() } as any,
      appointmentRepo as any,
      {} as any,
      {} as any,
      {
        getWallet: jest.fn().mockResolvedValue({ walletBalance: 5000 }),
      } as any,
      { sendConsultationRequestSms: jest.fn() } as any,
      triage as any,
      dataSource as any,
    );

    const response = await service.execute('I have chest pain');

    expect(response.toJSON()).toEqual(
      expect.objectContaining({
        error: true,
        message: 'EMERGENCY_CARE_RECOMMENDED',
      }),
    );
    expect(appointmentRepo.save).not.toHaveBeenCalled();
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
  });

  it('returns emergency guidance before requiring an initialized wallet', async () => {
    const commonService = {
      getLoggedInUser: jest.fn().mockResolvedValue({ id: 'patient_1' }),
    };
    const triage = {
      analyze: jest.fn().mockResolvedValue({
        consultationType: ConsultationType.GENERAL_PRACTITIONER,
        specialty: 'General Practitioner',
        urgency: 'emergency',
        confidence: 1,
        reasoning: 'Emergency red flags detected.',
      }),
    };
    const walletService = { getWallet: jest.fn().mockResolvedValue(null) };
    const service = new FindDoctorUseCase(
      commonService as any,
      { publish: jest.fn() } as any,
      { find: jest.fn(), findOne: jest.fn() } as any,
      {} as any,
      {} as any,
      walletService as any,
      { sendConsultationRequestSms: jest.fn() } as any,
      triage as any,
      { createQueryRunner: jest.fn() } as any,
    );

    const response = await service.execute('I cannot breathe');

    expect(response.toJSON().message).toBe('EMERGENCY_CARE_RECOMMENDED');
    expect(walletService.getWallet).not.toHaveBeenCalled();
  });
});

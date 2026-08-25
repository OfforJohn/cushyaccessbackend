import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { MobileSenderService } from './mobile-sender.service';
import { OtpPurpose } from './model/otp-purpose.enum';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MobileSenderService Termii templates', () => {
  let service: MobileSenderService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({
      data: { message_id: 'termii-message-id' },
    });
    service = new MobileSenderService({
      get: jest.fn((key: string) => {
        if (key === 'TWILIO_ACCOUNT_SID')
          return 'AC00000000000000000000000000000000';
        if (key === 'TWILIO_AUTH_TOKEN') return 'test-token';
        if (key === 'TERMI_SMS_API_KEY') return 'termii-test-key';
        return undefined;
      }),
    } as unknown as ConfigService);
  });

  const sentMessages = (): string[] =>
    mockedAxios.post.mock.calls.map((call) => (call[1] as { sms: string }).sms);

  it('starts mobile OTP messages with the customer name', async () => {
    await service.sendSms(
      '08012345678',
      4829,
      '234',
      OtpPurpose.PASSWORD_RESET,
      'Amina Yusuf',
    );

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://v3.api.termii.com/api/sms/send',
      expect.objectContaining({
        to: '2348012345678',
        from: 'OE ALERT',
        channel: 'dnd',
        sms: expect.stringMatching(
          /^Dear Amina Yusuf, your Cushy Access password reset code is: 4829\./,
        ),
      }),
      expect.objectContaining({ timeout: 15_000 }),
    );
  });

  it('addresses order and consultation recipients without duplicate titles', async () => {
    await service.sendOrderSmsNotif(
      '08020000000',
      '2348012345678',
      '12 Allen Avenue, Ikeja',
      15400,
      'Musa Bello',
      '234',
      '234',
    );
    await service.sendConsultationRequestSms('08030000000', {
      doctorName: 'Dr. Amina Yusuf',
      doctorCallingCode: '234',
      patientName: 'John Okafor',
      symptoms: 'Severe headache and fever',
      appointmentId: 'APPT-001',
    });

    expect(sentMessages()[0]).toBe(
      'Dear Musa Bello, you just received an order from 08012345678 to be delivered to 12 Allen Avenue, Ikeja for NGN 15400. Powered by Cushy Access.',
    );
    expect(sentMessages()[1]).toMatch(
      /^Dear Dr\. Amina Yusuf, you have a new consultation request from John Okafor\./,
    );
    expect(sentMessages()[1]).not.toContain('Dr. Dr.');
  });

  it('never interpolates a missing delivery address as null', async () => {
    await service.sendOrderSmsNotif(
      '08020000000',
      '07070333178',
      null,
      4050,
      'Chicken Republic',
      '234',
      '234',
    );

    expect(sentMessages()[0]).toBe(
      'Dear Chicken Republic, you just received an order from 07070333178 to be delivered to the address provided in the Cushy Access app for NGN 4050. Powered by Cushy Access.',
    );
    expect(sentMessages()[0]).not.toContain('null');
  });

  it('starts an assignment with the merchant name, location, and phone', async () => {
    await service.sendRiderAssignmentSms('08080000000', {
      riderName: 'Chidi Okoro',
      riderCallingCode: '234',
      pickupName: 'Chicken Republic',
      pickupLocation: 'New Nyanya, Nasarawa',
      pickupPhone: '08039990000',
      pickupCallingCode: '234',
      pickupTypeLabel: 'Restaurant',
      customerName: 'Ada Customer',
      customerPhone: '08031112222',
      customerCallingCode: '234',
      deliveryAddress: 'Flat 2, Blue Gate, Ado',
      riderNote: 'Call at the gate',
    });

    expect(sentMessages()[0]).toBe(
      'Dear Chidi Okoro, delivery from Chicken Republic in New Nyanya, Nasarawa has been assigned to you. Restaurant phone number: 08039990000. Customer: Ada Customer. Phone: 08031112222. Delivery: Flat 2, Blue Gate, Ado. Message to Rider: Call at the gate. Open the Cushy Rider app for navigation and live updates.',
    );
    expect(sentMessages()[0]).not.toContain('Jollof Rice');
    expect(sentMessages()[0]).not.toContain('Description:');
  });

  it('addresses both appointment recipients and formats the time', async () => {
    await service.sendAppointmentSmsNotif('08040000000', '08050000000', {
      patientName: 'Jane Doe',
      doctorName: 'Dr. Michael Adeyemi',
      patientCallingCode: '234',
      doctorCallingCode: '234',
      appointmentDay: 'THURSDAY',
      appointmentDate: '2026-07-30',
      appointmentTime: '14:30',
      consultationFee: 5000,
    });

    expect(sentMessages()).toEqual([
      'Dear Jane Doe, your appointment with Dr. Michael Adeyemi has been confirmed for Thursday, 30 July 2026 at 2:30 PM. Consultation Fee: NGN 5000. Powered by Cushy Access.',
      'Dear Dr. Michael Adeyemi, you have a new appointment with Jane Doe on 30 July 2026 at 2:30 PM. Powered by Cushy Access.',
    ]);
  });

  it('retries only a failed appointment recipient with a named fallback', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { message_id: 'patient-ok' } })
      .mockResolvedValueOnce({ data: { message: 'template rejected' } })
      .mockResolvedValueOnce({ data: { message_id: 'doctor-fallback-ok' } });

    await service.sendAppointmentSmsNotif('08040000000', '08050000000', {
      patientName: 'Jane Doe',
      doctorName: 'Michael Adeyemi',
      appointmentDay: 'Monday',
      appointmentDate: '30 July 2026',
      appointmentTime: '14:30',
      consultationFee: 5000,
    });

    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    expect(sentMessages()[2]).toBe(
      'Dear Dr. Michael Adeyemi, New appointment with Jane Doe on 30 July 2026 at 2:30 PM. Powered by Cushy Access.',
    );
  });

  it('names reminder and welcome recipients at the beginning', async () => {
    await service.sendAppointmentReminder('08060000000', {
      patientName: 'Jane Doe',
      doctorName: 'Dr. Michael Adeyemi',
      appointmentDate: '30 July 2026',
      appointmentTime: '14:30',
      reminderType: '1-hour',
    });
    await service.sendWelcomeSms('08070000000', 'Jane', 'Temp@1234');

    expect(sentMessages()[0]).toBe(
      'Dear Jane Doe, Reminder: your appointment with Dr. Michael Adeyemi is in 1 hour (Thursday, 30 July 2026) at 2:30 PM. Powered by Cushy Access.',
    );
    expect(sentMessages()[1]).toBe(
      'Dear Jane, Welcome to Cushy Access. Your account has been created successfully. Your temporary password is: Temp@1234. Please log in and change your password immediately.',
    );
  });

  it('formats the 24-hour reminder to match the submitted template', async () => {
    await service.sendAppointmentReminder('08060000000', {
      patientName: 'Jane Doe',
      doctorName: 'Michael Adeyemi',
      appointmentDate: '2026-07-31',
      appointmentTime: '14:30',
      reminderType: '24-hour',
    });

    expect(sentMessages()[0]).toBe(
      'Dear Jane Doe, Reminder: your appointment with Dr. Michael Adeyemi is tomorrow (Friday, 31 July 2026) at 2:30 PM. Powered by Cushy Access.',
    );
  });

  it('does not send a non-compliant message when the recipient name is missing', async () => {
    await expect(
      service.sendSms('08012345678', 4829, '234', OtpPurpose.VERIFICATION, ''),
    ).resolves.toBeNull();

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('preserves an explicitly international destination', async () => {
    await service.sendWelcomeSms('+447700900123', 'Ada', 'Temp@1234');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ to: '447700900123' }),
      expect.any(Object),
    );
  });

  it('does not retry an ambiguous network failure that may have delivered', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { message_id: 'patient-ok' } })
      .mockRejectedValueOnce(new Error('connection closed after request'));

    await service.sendAppointmentSmsNotif('08040000000', '08050000000', {
      patientName: 'Jane Doe',
      doctorName: 'Michael Adeyemi',
      appointmentDay: 'Monday',
      appointmentDate: '30 July 2026',
      appointmentTime: '14:30',
      consultationFee: 5000,
    });

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });
});

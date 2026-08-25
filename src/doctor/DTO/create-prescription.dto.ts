// create-prescription.dto.ts
export class MedicationDto {
  name: string;
  dosage: string;
  frequency: string;
  duration?: string;
  instructions?: string;
}

export class CreatePrescriptionDto {
  appointmentId: string;
  patientId: string;
  diagnosis?: string;
  notes?: string; // Changed from 'note' to match your frontend
  medications: MedicationDto[]; // This should be the only medications field
}

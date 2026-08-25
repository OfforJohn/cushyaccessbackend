import { Rider, RiderStatus } from 'src/riders/model/rider.entity';
import {
  DocumentStatus,
  DocumentType,
  RiderDocument,
} from 'src/riders/model/rider-document.entity';
import { reconcileRiderClearance } from '../../riders/rider-clearance';

const document = (
  documentType: DocumentType,
  status = DocumentStatus.VERIFIED,
) => ({ documentType, status }) as RiderDocument;

const completeDocuments = () => [
  document(DocumentType.ID_CARD),
  document(DocumentType.DRIVING_LICENSE),
  document(DocumentType.DRIVING_LICENSE),
  document(DocumentType.BIKE_REGISTRATION),
];

describe('reconcileRiderClearance', () => {
  it('activates only when every required uploaded document and flag is approved', () => {
    const rider = {
      status: RiderStatus.BACKGROUND_CHECK,
      trainingCompleted: true,
      backgroundCheckStatus: 'approved',
      isOnline: false,
    } as Rider;

    reconcileRiderClearance(rider, completeDocuments());

    expect(rider.status).toBe(RiderStatus.ACTIVE);
  });

  it('does not accept one verified side when another permit image is pending', () => {
    const rider = {
      status: RiderStatus.ACTIVE,
      trainingCompleted: true,
      backgroundCheckStatus: 'approved',
      isOnline: true,
    } as Rider;
    const documents = completeDocuments();
    documents[2].status = DocumentStatus.PENDING;

    reconcileRiderClearance(rider, documents);

    expect(rider.status).toBe(RiderStatus.DOCUMENT_VERIFICATION);
    expect(rider.isOnline).toBe(false);
  });

  it('moves verified riders through background check and training stages', () => {
    const rider = {
      status: RiderStatus.DOCUMENT_VERIFICATION,
      trainingCompleted: false,
      backgroundCheckStatus: 'pending',
      isOnline: false,
    } as Rider;

    reconcileRiderClearance(rider, completeDocuments());
    expect(rider.status).toBe(RiderStatus.BACKGROUND_CHECK);

    rider.backgroundCheckStatus = 'approved';
    reconcileRiderClearance(rider, completeDocuments());
    expect(rider.status).toBe(RiderStatus.TRAINING);
  });

  it('demotes and takes an active rider offline when approval is revoked', () => {
    const rider = {
      status: RiderStatus.ACTIVE,
      trainingCompleted: true,
      backgroundCheckStatus: 'rejected',
      isOnline: true,
    } as Rider;

    reconcileRiderClearance(rider, completeDocuments());

    expect(rider.status).toBe(RiderStatus.BACKGROUND_CHECK);
    expect(rider.isOnline).toBe(false);
  });

  it.each([RiderStatus.SUSPENDED, RiderStatus.REJECTED, RiderStatus.INACTIVE])(
    'does not reactivate an administratively controlled %s rider',
    (status) => {
      const rider = {
        status,
        trainingCompleted: true,
        backgroundCheckStatus: 'approved',
        isOnline: true,
      } as Rider;

      reconcileRiderClearance(rider, completeDocuments());

      expect(rider.status).toBe(status);
      expect(rider.isOnline).toBe(false);
    },
  );
});

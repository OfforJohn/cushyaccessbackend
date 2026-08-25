import { Rider, RiderStatus } from './model/rider.entity';
import {
  DocumentStatus,
  DocumentType,
  RiderDocument,
} from './model/rider-document.entity';

const REQUIRED_DOCUMENT_TYPES = [
  DocumentType.ID_CARD,
  DocumentType.DRIVING_LICENSE,
  DocumentType.BIKE_REGISTRATION,
];

export const reconcileRiderClearance = (
  rider: Rider,
  documents: RiderDocument[],
): void => {
  if (
    [
      RiderStatus.SUSPENDED,
      RiderStatus.REJECTED,
      RiderStatus.INACTIVE,
    ].includes(rider.status)
  ) {
    rider.isOnline = false;
    return;
  }

  rider.status = determineRiderClearanceStatus(rider, documents);

  if (rider.status !== RiderStatus.ACTIVE) {
    rider.isOnline = false;
  }
};

export const determineRiderClearanceStatus = (
  rider: Rider,
  documents: RiderDocument[],
): RiderStatus => {
  const requiredDocuments = documents.filter((document) =>
    REQUIRED_DOCUMENT_TYPES.includes(document.documentType),
  );
  const hasEveryType = REQUIRED_DOCUMENT_TYPES.every((type) =>
    requiredDocuments.some((document) => document.documentType === type),
  );
  const allDocumentsVerified =
    hasEveryType &&
    requiredDocuments.every(
      (document) => document.status === DocumentStatus.VERIFIED,
    );

  if (!allDocumentsVerified) {
    return RiderStatus.DOCUMENT_VERIFICATION;
  }
  if (rider.backgroundCheckStatus !== 'approved') {
    return RiderStatus.BACKGROUND_CHECK;
  }
  if (!rider.trainingCompleted) return RiderStatus.TRAINING;
  return RiderStatus.ACTIVE;
};

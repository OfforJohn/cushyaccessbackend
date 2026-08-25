import { EntityManager } from 'typeorm';

export const getRiderDocumentLockKey = (riderId: string): string =>
  `rider-documents:${riderId}`;

export const lockRiderDocumentMutation = async (
  manager: Pick<EntityManager, 'query'>,
  riderId: string,
): Promise<void> => {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    getRiderDocumentLockKey(riderId),
  ]);
};

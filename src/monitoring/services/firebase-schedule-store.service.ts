import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore, Timestamp } from 'firebase-admin/firestore';

const COLLECTION_NAME = 'healthMonitorSchedules';

@Injectable()
export class FirebaseScheduleStoreService {
  private readonly logger = new Logger(FirebaseScheduleStoreService.name);
  private firestore?: Firestore;

  private getDb(): Firestore {
    if (this.firestore) return this.firestore;

    const encodedCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    if (!encodedCredentials) {
      throw new ServiceUnavailableException(
        'Backend monitoring storage is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 in Render.',
      );
    }

    try {
      const serviceAccount = JSON.parse(
        Buffer.from(encodedCredentials, 'base64').toString('utf8'),
      );
      const existingApp = getApps().find((app) => app.name === 'health-monitor-schedules');
      const app = existingApp || initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.project_id,
      }, 'health-monitor-schedules');
      this.firestore = getFirestore(app);
      return this.firestore;
    } catch (error) {
      this.logger.error(`Could not initialize Firebase schedule storage: ${error instanceof Error ? error.message : 'unknown error'}`);
      throw new ServiceUnavailableException('Backend monitoring storage could not connect to Firebase.');
    }
  }

  async getSchedule(userId: string): Promise<Record<string, any> | null> {
    const snapshot = await this.getDb().collection(COLLECTION_NAME).doc(userId).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() || {};
    return {
      ...data,
      lastCheckedAt: data.lastCheckedAt instanceof Timestamp
        ? data.lastCheckedAt.toDate().toISOString()
        : data.lastCheckedAt ?? null,
      nextRunAt: data.nextRunAt instanceof Timestamp
        ? data.nextRunAt.toDate().toISOString()
        : data.nextRunAt ?? null,
      updatedAt: data.updatedAt instanceof Timestamp
        ? data.updatedAt.toDate().toISOString()
        : data.updatedAt ?? null,
    };
  }

  async saveSchedule(userId: string, patch: Record<string, unknown>): Promise<void> {
    await this.getDb().collection(COLLECTION_NAME).doc(userId).set({
      ...patch,
      userId,
      updatedAt: Timestamp.now(),
    }, { merge: true });
  }

  async claimDueSchedules(now: Date, limit: number): Promise<Array<{ userId: string; schedule: Record<string, any> }>> {
    const db = this.getDb();
    const snapshot = await db.collection(COLLECTION_NAME)
      .where('enabled', '==', true)
      .limit(limit)
      .get();

    const due = snapshot.docs.filter((doc) => {
      const nextRunAt = doc.get('nextRunAt');
      return nextRunAt instanceof Timestamp && nextRunAt.toMillis() <= now.getTime();
    });

    return Promise.all(due.map(async (doc) => {
      const ref = doc.ref;
      const claimedSchedule = await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(ref);
        if (!latest.exists || latest.get('enabled') !== true) return null;
        const nextRunAt = latest.get('nextRunAt');
        if (!(nextRunAt instanceof Timestamp) || nextRunAt.toMillis() > now.getTime()) return null;

        const schedule = latest.data() || {};
        const intervalMinutes = Math.max(5, Number(schedule.intervalMinutes) || 15);
        transaction.update(ref, {
          nextRunAt: Timestamp.fromDate(new Date(now.getTime() + intervalMinutes * 60_000)),
          updatedAt: Timestamp.now(),
        });
        return { ...schedule, intervalMinutes };
      });
      return claimedSchedule
        ? { userId: doc.id, schedule: claimedSchedule as Record<string, any> }
        : null;
    })).then((items) => items.filter((item): item is { userId: string; schedule: Record<string, any> } => item !== null));
  }
}

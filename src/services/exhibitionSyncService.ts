import {
  collection, doc, getDocFromServer, getDocsFromServer, onSnapshot, runTransaction, writeBatch, type DocumentReference,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { commitBatchesInChunks } from '../lib/chunkBatch';
import { buildExhibitionCollection, type ExhibitionPeriod } from '../domain/exhibition/collection';
import { normalizeStudentYear } from '../domain/members/memberIdentity';
import { exhibitionRevisionRef, requestExhibitionRefresh } from './exhibitionRevision';
import type { Member, Session } from '../types';

export interface ExhibitionSettings {
  enabled: boolean;
  period: ExhibitionPeriod;
  gameMapping: { sourceId: string; pinId: string }[];
  descriptions?: Record<string, string>;
}

export async function loadExhibitionSettings(exhibitionId: string) {
  const snapshot = await getDocFromServer(doc(db, 'exhibitionSettings', exhibitionId));
  return (snapshot.data() as ExhibitionSettings | undefined) ?? null;
}

export async function loadExhibitionStatus(exhibitionId: string) {
  const [source, progress, diagnostics] = await Promise.all([
    getDocFromServer(exhibitionRevisionRef()), getDocFromServer(doc(db, 'exhibitionSync', 'progress')),
    getDocFromServer(doc(db, 'exhibitionDiagnostics', exhibitionId)),
  ]);
  return {
    pending: Number(source.data()?.revision ?? 0) > Number(progress.data()?.revision ?? 0),
    unmappedGameIds: (diagnostics.data()?.unmappedGameIds ?? []) as string[],
    missingMemberIds: (diagnostics.data()?.missingMemberIds ?? []) as string[],
  };
}

export async function retryExhibitionRefresh() {
  const batch = writeBatch(db);
  requestExhibitionRefresh(batch);
  await batch.commit();
}

export async function saveExhibitionSettings(exhibitionId: string, settings: ExhibitionSettings) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'exhibitionSettings', exhibitionId), settings);
  if (!settings.enabled) {
    batch.set(doc(db, 'exhibitionAccess', exhibitionId), { enabled: false, generationId: '' });
  }
  requestExhibitionRefresh(batch);
  await batch.commit();
}

/** Process the latest durable revision. A disconnected or slower browser can safely retry. */
export async function refreshExhibitions(): Promise<boolean> {
  const revisionRef = exhibitionRevisionRef();
  const source = await getDocFromServer(revisionRef);
  const revision = Number(source.data()?.revision ?? 0);
  const progressRef = doc(db, 'exhibitionSync', 'progress');
  const progress = await getDocFromServer(progressRef);
  if (!revision || Number(progress.data()?.revision ?? 0) >= revision) return true;

  const settings = await getDocsFromServer(collection(db, 'exhibitionSettings'));
  const active = settings.docs.filter(snapshot => (snapshot.data() as ExhibitionSettings).enabled);
  const generationId = String(revision);
  const operations: Parameters<typeof commitBatchesInChunks>[1] = [];
  const changes: {
    access: DocumentReference;
    diagnostics: DocumentReference;
    unmappedGameIds: string[];
    missingMemberIds: string[];
    descriptions: Record<string, string>;
  }[] = [];
  if (active.length) {
    const [sessionSnapshot, memberSnapshot] = await Promise.all([
      getDocsFromServer(collection(db, 'sessions')),
      getDocsFromServer(collection(db, 'members')),
    ]);
    const sessions = sessionSnapshot.docs.map(snapshot => snapshot.data() as Session);
    const members = memberSnapshot.docs.map(snapshot => {
      const member = snapshot.data() as Member;
      return { id: snapshot.id, name: member.name, yearLabel: normalizeStudentYear(member.studentId ?? '') };
    });
    for (const snapshot of active) {
      const { period, gameMapping, descriptions = {} } = snapshot.data() as ExhibitionSettings;
      const result = await buildExhibitionCollection(snapshot.id, period, sessions, members,
        new Map(gameMapping.map(({ sourceId, pinId }) => [sourceId, pinId])));
      const access = doc(db, 'exhibitionAccess', snapshot.id);
      for (const kind of ['names', 'profiles'] as const) {
        for (const [id, data] of result[kind]) {
          operations.push({ type: 'set', ref: doc(access, 'generations', generationId, kind, id), data });
        }
      }
      changes.push({ access, diagnostics: doc(db, 'exhibitionDiagnostics', snapshot.id),
        unmappedGameIds: result.unmappedGameIds, missingMemberIds: result.missingMemberIds, descriptions });
    }
  }
  // Avoid staging a revision already known to have changed while reading inputs.
  const latest = await getDocFromServer(revisionRef);
  if (latest.data()?.revision !== revision) return false;
  await commitBatchesInChunks(db, operations);

  return runTransaction(db, async transaction => {
    const [current, applied] = await Promise.all([transaction.get(revisionRef), transaction.get(progressRef)]);
    if (current.data()?.revision !== revision) return false;
    if (Number(applied.data()?.revision ?? 0) >= revision) return true;
    for (const { access, diagnostics, unmappedGameIds, missingMemberIds, descriptions } of changes) {
      transaction.set(access, { enabled: true, generationId, descriptions });
      transaction.set(diagnostics, { revision, unmappedGameIds, missingMemberIds });
    }
    transaction.set(progressRef, { revision });
    return true;
  });
}

export type ExhibitionSyncStatus = 'idle' | 'syncing' | 'pending';

export function watchExhibitionSync(setStatus: (status: ExhibitionSyncStatus) => void) {
  let stopped = false;
  let running = false;
  let requested = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function schedule(delay = 500) {
    if (stopped) return;
    requested = true;
    if (running) return;
    clearTimeout(retry);
    retry = setTimeout(() => { void run(); }, delay);
  }

  async function run() {
    running = true;
    requested = false;
    setStatus('syncing');
    let done = false;
    try {
      done = await refreshExhibitions();
    } catch (error) {
      console.warn('Exhibition refresh pending', (error as { code?: string }).code ?? 'unknown');
    } finally {
      running = false;
      if (!stopped) {
        setStatus(done ? 'idle' : 'pending');
        if (requested || !done) schedule(requested ? 500 : 30_000);
      }
    }
  }

  const unsubscribe = onSnapshot(exhibitionRevisionRef(), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.exists() && !snapshot.metadata.hasPendingWrites) schedule();
  }, () => { if (!stopped) setStatus('pending'); });
  const onReconnect = () => schedule();
  window.addEventListener('online', onReconnect);
  return () => {
    stopped = true;
    clearTimeout(retry);
    unsubscribe();
    window.removeEventListener('online', onReconnect);
  };
}

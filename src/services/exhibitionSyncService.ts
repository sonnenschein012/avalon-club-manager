import { withFirestoreDeadline } from '../lib/firestoreDeadline';
import {
  Bytes, collection, deleteField, doc, getDocFromServer, getDocsFromServer, limit, onSnapshot, query, where, runTransaction,
  serverTimestamp, Timestamp, writeBatch, type DocumentData, type DocumentReference,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { commitBatchesInChunks } from '../lib/chunkBatch';
import { buildExhibitionCollection, type ExhibitionPeriod, type ExhibitionProfile } from '../domain/exhibition/collection';
import {
  defaultExhibitionPin, exhibitionPins, exhibitionPublicationWindow, fallbackExhibitionPin, isExhibitionImageUpload, maxExhibitionImageBytes,
  type ExhibitionCopy, type ExhibitionSchedule, type ExhibitionVisibility,
} from '../domain/exhibition/presentation';
import { normalizeStudentYear } from '../domain/members/memberIdentity';
import { exhibitionRevisionRef, requestExhibitionRefresh } from './exhibitionRevision';
import type { Member, Session } from '../types';

export interface ExhibitionSettings {
  enabled: boolean;
  period: ExhibitionPeriod;
  gameMapping: { sourceId: string; pinId: string }[];
  descriptions?: Record<string, string>;
  images?: Record<string, string>;
  copy?: ExhibitionCopy;
  visibility?: ExhibitionVisibility;
  schedule?: ExhibitionSchedule;
}

export async function loadExhibitionSettings(exhibitionId: string) {
  const snapshot = await getDocFromServer(doc(db, 'exhibitionSettings', exhibitionId));
  return (snapshot.data() as ExhibitionSettings | undefined) ?? null;
}

export async function loadExhibitionStatus(exhibitionId: string) {
  const [source, progress, diagnostics, access] = await withFirestoreDeadline(() => Promise.all([
    getDocFromServer(exhibitionRevisionRef()), getDocFromServer(doc(db, 'exhibitionSync', 'progress')),
    getDocFromServer(doc(db, 'exhibitionDiagnostics', exhibitionId)),
    getDocFromServer(doc(db, 'exhibitionAccess', exhibitionId)),
  ]));
  const active = access.data();
  const diagnostic = diagnostics.data();
  const generationId = active?.enabled === true && typeof active.generationId === 'string' && active.generationId
    ? active.generationId : undefined;
  return {
    pending: Number(source.data()?.revision ?? 0) > Number(progress.data()?.revision ?? 0),
    unmappedGameIds: (diagnostics.data()?.unmappedGameIds ?? []) as string[],
    missingMemberIds: (diagnostics.data()?.missingMemberIds ?? []) as string[],
    lastSyncedAt: (diagnostics.data()?.syncedAt as Timestamp | undefined)?.toDate(),
    profileCount: diagnostics.data()?.profileCount as number | undefined,
    published: Boolean(generationId),
    generationId,
    publishedGameKeys: generationId && String(diagnostic?.revision) === generationId && Array.isArray(diagnostic?.publishedGameKeys)
      ? diagnostic.publishedGameKeys as string[] : undefined,
    startsAt: (access.data()?.startsAt as Timestamp | undefined)?.toDate(),
    endsAt: (access.data()?.endsAt as Timestamp | undefined)?.toDate(),
  };
}

function gameKeysInProfiles(profiles: Iterable<ExhibitionProfile>) {
  const keys = new Set<string>();
  for (const profile of profiles) for (const day of profile.days) {
    for (const id of day.gameIds) keys.add(id);
  }
  return [...keys].sort();
}

export async function loadPublishedExhibitionGameKeys(exhibitionId: string, generationId: string) {
  const profiles = collection(db, 'exhibitionAccess', exhibitionId, 'generations', generationId, 'profiles');
  return withFirestoreDeadline(async signal => {
    const snapshot = await getDocsFromServer(profiles);
    signal.throwIfAborted();
    return gameKeysInProfiles(snapshot.docs.map(profile => profile.data() as ExhibitionProfile));
  });
}

export async function retryExhibitionRefresh() {
  const batch = writeBatch(db);
  requestExhibitionRefresh(batch);
  await withFirestoreDeadline(() => batch.commit());
}

function publicationWindow(settings: ExhibitionSettings) {
  if (settings.visibility !== 'temporary') return null;
  const window = settings.schedule && exhibitionPublicationWindow(settings.schedule);
  if (!window) throw new Error('Invalid exhibition publication window');
  return { startsAt: Timestamp.fromDate(window.start), endsAt: Timestamp.fromDate(window.end) };
}

function recordSettingsKey(settings: ExhibitionSettings) {
  const period = settings.period;
  return JSON.stringify([
    period.kind, period.kind === 'semester' ? period.semester : '',
    period.kind === 'range' ? [period.start, period.end] : [],
    settings.visibility ?? 'public', settings.schedule?.start, settings.schedule?.end,
    settings.gameMapping.map(({ sourceId, pinId }) => [sourceId, pinId] as const).sort(([left], [right]) => left.localeCompare(right)),
  ]);
}

export async function saveExhibitionSettings(exhibitionId: string, settings: ExhibitionSettings,
  uploads: ReadonlyMap<string, { version: string; bytes: Uint8Array }> = new Map()) {
  const access = doc(db, 'exhibitionAccess', exhibitionId);
  const settingsRef = doc(db, 'exhibitionSettings', exhibitionId);
  const appearance = doc(db, 'exhibitionPinAppearance', exhibitionId);
  const window = publicationWindow(settings);
  return withFirestoreDeadline(signal => runTransaction(db, async transaction => {
    const [saved, current] = await Promise.all([transaction.get(settingsRef), transaction.get(access)]);
    signal.throwIfAborted();
    const previous = saved.data() as ExhibitionSettings | undefined;
    const needsSync = settings.enabled && (!previous?.enabled || !current.data()?.generationId ||
      recordSettingsKey(previous) !== recordSettingsKey(settings));
    transaction.set(settingsRef, settings);
    if (settings.copy) transaction.set(doc(db, 'exhibitionCopy', exhibitionId), { copy: settings.copy });
    transaction.set(appearance, {
      descriptions: settings.descriptions ?? {}, images: settings.images ?? {},
    });
    for (const [key, value] of Object.entries(settings.images ?? {})) {
      if (isExhibitionImageUpload(value) && previous?.images?.[key] !== value && uploads.get(key)?.version !== value) {
        throw new Error('The saved image changed. Reload the exhibition settings.');
      }
    }
    for (const [key, upload] of uploads) {
      if (settings.images?.[key] !== upload.version) continue;
      if (!isExhibitionImageUpload(upload.version) || !upload.bytes.length || upload.bytes.length > maxExhibitionImageBytes) {
        throw new Error('Invalid exhibition image');
      }
      transaction.set(doc(appearance, 'exhibitionImages', key), { version: upload.version, bytes: Bytes.fromUint8Array(upload.bytes) });
    }
    for (const [key, value] of Object.entries(previous?.images ?? {})) {
      if (isExhibitionImageUpload(value) && !isExhibitionImageUpload(settings.images?.[key])) {
        transaction.delete(doc(appearance, 'exhibitionImages', key));
      }
    }
    if (!settings.enabled) {
      transaction.set(access, { enabled: false, generationId: '' });
    } else if (current.data()?.enabled && current.data()?.generationId) {
      transaction.update(access, {
        descriptions: settings.descriptions ?? {},
        ...(window ?? { startsAt: deleteField(), endsAt: deleteField() }),
      });
    }
    if (needsSync || (previous?.enabled && !settings.enabled)) requestExhibitionRefresh(transaction);
    return needsSync;
  }));
}

async function pruneSupersededGenerations(exhibitionIds: string[], signal: AbortSignal) {
  let complete = true;
  for (const exhibitionId of exhibitionIds) {
    signal.throwIfAborted();
    const access = doc(db, 'exhibitionAccess', exhibitionId);
    const current = (await getDocFromServer(access)).data();
    const activeRevision = /^(?:v2-)?([1-9][0-9]*)$/.exec(current?.generationId ?? '')?.[1];
    if (!current?.enabled || !activeRevision) continue;

    const obsolete = await getDocsFromServer(query(collection(access, 'generations'),
      where('revision', '<', Number(activeRevision)), limit(3)));
    for (const generation of obsolete.docs) {
      const entries = await Promise.all(['names', 'profiles'].map(kind =>
        getDocsFromServer(collection(generation.ref, kind))));
      signal.throwIfAborted();
      await commitBatchesInChunks(db, entries.flatMap(snapshot =>
        snapshot.docs.map(item => ({ type: 'delete' as const, ref: item.ref }))));
      signal.throwIfAborted();
      // Retain the manifest until both child collections have been deleted.
      const batch = writeBatch(db);
      batch.delete(generation.ref);
      await batch.commit();
    }
    if (obsolete.size === 3) complete = false;
  }
  return complete;
}

type SyncStep = '원본 조회' | '변경 확인' | '전시 데이터 생성' | '전시 데이터 저장' | '공개 전환' | '이전 데이터 정리';

export interface ExhibitionSyncError {
  step: string;
  code: string;
}

function syncError(step: string, error: unknown): ExhibitionSyncError {
  const code = (error as { code?: string } | null)?.code;
  return { step, code: typeof code === 'string' ? code : 'unexpected-error' };
}

/** Check the operating records even when no browser was open at the time of a change. */
export async function refreshExhibitions(
  reportError?: (failure: ExhibitionSyncError) => void,
  lifecycle?: AbortSignal,
): Promise<boolean> {
  let step: SyncStep = '원본 조회';
  try {
    return await withFirestoreDeadline(deadline => {
      const signal = lifecycle ? AbortSignal.any([deadline, lifecycle]) : deadline;
      signal.throwIfAborted();
      return reconcile(signal, value => { step = value; });
    }, 45_000);
  } catch (error) {
    reportError?.(syncError(step, error));
    throw error;
  }
}

async function reconcile(signal: AbortSignal, reportStep: (step: SyncStep) => void): Promise<boolean> {
  const revisionRef = exhibitionRevisionRef();
  const source = (await getDocFromServer(revisionRef)).data();
  signal.throwIfAborted();
  const observedRevision = Number(source?.revision ?? 0);
  const progressRef = doc(db, 'exhibitionSync', 'progress');
  const settings = await getDocsFromServer(collection(db, 'exhibitionSettings'));
  signal.throwIfAborted();
  const active = settings.docs.filter(snapshot => (snapshot.data() as ExhibitionSettings).enabled);
  const activeIds = active.map(snapshot => snapshot.id);
  const [sessionSnapshot, memberSnapshot, gameSnapshot] = active.length ? await Promise.all([
    getDocsFromServer(collection(db, 'sessions')),
    getDocsFromServer(collection(db, 'members')),
    getDocsFromServer(collection(db, 'games')),
  ]) : [null, null, null];
  signal.throwIfAborted();
  const sessions = (sessionSnapshot?.docs ?? []).map(snapshot => {
    const session = snapshot.data() as Session;
    return {
      date: session.date,
      groups: (session.groups ?? []).map(group => ({ id: group.id ?? '', memberIds: group.memberIds ?? [], gameIds: group.gameIds ?? [] })),
    };
  });
  const members = (memberSnapshot?.docs ?? []).map(snapshot => {
    const member = snapshot.data() as Member;
    return { id: snapshot.id, name: member.name ?? '', yearLabel: normalizeStudentYear(member.studentId ?? '') };
  });
  const games = (gameSnapshot?.docs ?? []).map(snapshot => ({
    id: snapshot.id,
    title: String(snapshot.data().title ?? ''),
  }));
  const defaults = new Map(games.map(({ id, title }) => [id, defaultExhibitionPin(id, title)]));
  const payload = new TextEncoder().encode(JSON.stringify([sessions, members, games]));
  const fingerprint = 'projection-v4:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', payload)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  reportStep('변경 확인');
  signal.throwIfAborted();
  const revision = await runTransaction(db, async transaction => {
    signal.throwIfAborted();
    const current = (await transaction.get(revisionRef)).data();
    signal.throwIfAborted();
    // A settings write or a newer scan invalidates these inputs.
    if (Number(current?.revision ?? 0) !== observedRevision) return null;
    if (current?.fingerprint === fingerprint) return observedRevision;
    if (!active.length && !observedRevision) return 0;
    const next = observedRevision + 1;
    transaction.set(revisionRef, { revision: next, fingerprint });
    return next;
  });
  signal.throwIfAborted();
  if (revision === null) return false;
  if (!revision) return true;

  const progress = await getDocFromServer(progressRef);
  signal.throwIfAborted();
  if (Number(progress.data()?.revision ?? 0) >= revision) {
    reportStep('이전 데이터 정리');
    return pruneSupersededGenerations(activeIds, signal);
  }

  reportStep('전시 데이터 생성');
  const generationId = String(revision);
  const operations: { ref: DocumentReference; data: DocumentData }[] = [];
  const changes: {
    access: DocumentReference;
    diagnostics: DocumentReference;
    unmappedGameIds: string[];
    missingMemberIds: string[];
    descriptions: Record<string, string>;
    window: ReturnType<typeof publicationWindow>;
    profileCount: number;
    publishedGameKeys: string[];
  }[] = [];
  for (const snapshot of active) {
    const settings = snapshot.data() as ExhibitionSettings;
    const { period, gameMapping, descriptions = {} } = settings;
    const excluded = new Set(gameMapping.filter(({ pinId }) => pinId === '').map(({ sourceId }) => sourceId));
    const mapping = new Map(defaults);
    for (const { sourceId, pinId } of gameMapping) {
      if (Object.hasOwn(exhibitionPins, pinId) || pinId === fallbackExhibitionPin(sourceId)) mapping.set(sourceId, pinId);
      else mapping.delete(sourceId);
    }
    const titlesBySourceId = new Map(games.filter(game => game.title.trim() && !excluded.has(game.id))
      .map(({ id, title }) => [id, title.trim()]));
    const result = await buildExhibitionCollection(snapshot.id, period, sessions, members,
      mapping, titlesBySourceId);
    const access = doc(db, 'exhibitionAccess', snapshot.id);
    operations.push({ ref: doc(access, 'generations', generationId), data: { revision } });
    for (const kind of ['names', 'profiles'] as const) {
      for (const [id, data] of result[kind]) {
        operations.push({ ref: doc(access, 'generations', generationId, kind, id), data });
      }
    }
    changes.push({ access, diagnostics: doc(db, 'exhibitionDiagnostics', snapshot.id),
      unmappedGameIds: result.unmappedGameIds.filter(id => !excluded.has(id)),
      missingMemberIds: result.missingMemberIds, descriptions, window: publicationWindow(settings), profileCount: result.profiles.size,
      publishedGameKeys: gameKeysInProfiles(result.profiles.values()) });
  }
  reportStep('전시 데이터 저장');
  // Each chunk checks the revision in its transaction so a superseded worker
  // cannot recreate children after another worker has retired its manifest.
  for (let start = 0; start < operations.length; start += 400) {
    signal.throwIfAborted();
    const staged = await runTransaction(db, async transaction => {
      signal.throwIfAborted();
      const current = await transaction.get(revisionRef);
      signal.throwIfAborted();
      if (current.data()?.revision !== revision) return false;
      for (const { ref, data } of operations.slice(start, start + 400)) transaction.set(ref, data);
      return true;
    });
    if (!staged) return false;
  }

  reportStep('공개 전환');
  signal.throwIfAborted();
  const appliedRevision = await runTransaction(db, async transaction => {
    signal.throwIfAborted();
    const [current, applied] = await Promise.all([transaction.get(revisionRef), transaction.get(progressRef)]);
    signal.throwIfAborted();
    if (current.data()?.revision !== revision) return false;
    if (Number(applied.data()?.revision ?? 0) >= revision) return true;
    for (const { access, diagnostics, unmappedGameIds, missingMemberIds, descriptions, window, profileCount, publishedGameKeys } of changes) {
      transaction.set(access, { enabled: true, generationId, descriptions, ...window });
      transaction.set(diagnostics, { revision, unmappedGameIds, missingMemberIds, profileCount, publishedGameKeys, syncedAt: serverTimestamp() });
    }
    transaction.set(progressRef, { revision });
    return true;
  });
  reportStep('이전 데이터 정리');
  signal.throwIfAborted();
  return appliedRevision && pruneSupersededGenerations(activeIds, signal);
}

export type ExhibitionSyncStatus = 'idle' | 'syncing' | 'pending' | 'error';

export function watchExhibitionSync(
  setStatus: (status: ExhibitionSyncStatus) => void,
  setError: (failure: ExhibitionSyncError | null) => void,
  watch: 'sources' | 'requests',
) {
  const controller = new AbortController();
  let stopped = false;
  let running = false;
  let requested = false;
  let failures = 0;
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
    let failure: ExhibitionSyncError | undefined;
    try {
      done = await refreshExhibitions(error => { failure = error; }, controller.signal);
      failures = 0;
    } catch {
      failures++;
    } finally {
      running = false;
      if (!stopped) {
        setError(failure ?? null);
        setStatus(failure ? 'error' : done ? 'idle' : 'pending');
        if (requested || !done) schedule(requested ? 500 : Math.min(15_000 * 2 ** Math.min(failures, 3), 120_000));
      }
    }
  }

  let monitorFailed = false;
  const watches = (watch === 'requests' ? [] : ['sessions', 'members', 'games']).map(path =>
    onSnapshot(collection(db, path), { includeMetadataChanges: true }, snapshot => {
      if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) schedule();
    }, error => {
      monitorFailed = true;
      if (stopped) return;
      setError(syncError('원본 변경 감시', error));
      setStatus('error');
      schedule();
    }));
  if (watch !== 'sources') {
    watches.push(onSnapshot(exhibitionRevisionRef(), { includeMetadataChanges: true }, snapshot => {
      if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) schedule();
    }, error => {
      monitorFailed = true;
      if (stopped) return;
      setError(syncError('동기화 요청 감시', error));
      setStatus('error');
      schedule();
    }));
  }
  // A listener can terminate on temporary permission changes. Keep reconciliation
  // available until the administrator reopens the page and attaches new listeners.
  const recovery = setInterval(() => { if (monitorFailed) schedule(); }, 120_000);
  const onReconnect = () => schedule();
  window.addEventListener('online', onReconnect);
  window.addEventListener('focus', onReconnect);
  schedule();
  function stop() {
    stopped = true;
    controller.abort();
    clearTimeout(retry);
    clearInterval(recovery);
    watches.forEach(unsubscribe => unsubscribe());
    window.removeEventListener('online', onReconnect);
    window.removeEventListener('focus', onReconnect);
  }
  return { stop, request: () => schedule(0) };
}

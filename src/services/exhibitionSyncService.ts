import { withFirestoreDeadline } from '../lib/firestoreDeadline';
import {
  Bytes, collection, deleteField, doc, getDocFromServer, getDocsFromServer, limit, onSnapshot, query, where, runTransaction,
  serverTimestamp, Timestamp, type DocumentData, type DocumentReference, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
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
  const contentRevision = active?.contentRevision ?? Number(generationId);
  return {
    pending: Number(source.data()?.revision ?? 0) > Number(progress.data()?.revision ?? 0),
    unmappedGameIds: (diagnostics.data()?.unmappedGameIds ?? []) as string[],
    missingMemberIds: (diagnostics.data()?.missingMemberIds ?? []) as string[],
    lastSyncedAt: (diagnostics.data()?.syncedAt as Timestamp | undefined)?.toDate(),
    profileCount: diagnostics.data()?.profileCount as number | undefined,
    published: Boolean(generationId),
    generationId,
    publishedGameKeys: generationId && (diagnostic?.revision === contentRevision || String(diagnostic?.revision) === generationId) && Array.isArray(diagnostic?.publishedGameKeys)
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
    settings.gameMapping.map(({ sourceId, pinId }) => [sourceId, pinId] as const).sort(([left], [right]) => left.localeCompare(right)),
  ]);
}

export async function saveExhibitionSettings(exhibitionId: string, settings: ExhibitionSettings,
  uploads: ReadonlyMap<string, { version: string; bytes: Uint8Array }> = new Map()) {
  const access = doc(db, 'exhibitionAccess', exhibitionId);
  const settingsRef = doc(db, 'exhibitionSettings', exhibitionId);
  const appearance = doc(db, 'exhibitionPinAppearance', exhibitionId);
  const copyRef = doc(db, 'exhibitionCopy', exhibitionId);
  const window = publicationWindow(settings);
  return withFirestoreDeadline(signal => runTransaction(db, async transaction => {
    const [saved, current, savedAppearance, savedCopy] = await Promise.all([
      transaction.get(settingsRef), transaction.get(access), transaction.get(appearance),
      settings.copy ? transaction.get(copyRef) : undefined,
    ]);
    signal.throwIfAborted();
    const previous = saved.data() as ExhibitionSettings | undefined;
    const needsSync = settings.enabled && (!previous?.enabled || !current.data()?.generationId ||
      recordSettingsKey(previous) !== recordSettingsKey(settings));
    if (canonical(previous) !== canonical(settings)) transaction.set(settingsRef, settings);
    if (settings.copy && canonical(savedCopy?.data()?.copy) !== canonical(settings.copy)) {
      transaction.set(copyRef, { copy: settings.copy });
    }
    const pinContent = { descriptions: settings.descriptions ?? {}, images: settings.images ?? {} };
    if (canonical(savedAppearance.data()) !== canonical(pinContent)) transaction.set(appearance, pinContent);
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
    if (!settings.enabled && (current.data()?.enabled || previous?.enabled)) {
      transaction.set(access, { enabled: false, generationId: '' });
    } else if (settings.enabled && current.data()?.enabled && current.data()?.generationId && (
      canonical(current.data()?.descriptions ?? {}) !== canonical(settings.descriptions ?? {}) ||
      current.data()?.startsAt?.toMillis() !== window?.startsAt.toMillis() ||
      current.data()?.endsAt?.toMillis() !== window?.endsAt.toMillis())) {
      transaction.update(access, {
        descriptions: settings.descriptions ?? {},
        ...(window ?? { startsAt: deleteField(), endsAt: deleteField() }),
      });
    }
    if (needsSync || (previous?.enabled && !settings.enabled)) requestExhibitionRefresh(transaction);
    return needsSync;
  }));
}

function pacificDay() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

async function pruneSupersededGeneration(signal: AbortSignal, day: string) {
  const maintenance = doc(db, 'exhibitionSync', 'cleanup');
  if ((await getDocFromServer(maintenance)).data()?.day === day) return;
  const enabled = await getDocsFromServer(query(collection(db, 'exhibitionSettings'), where('enabled', '==', true)));
  for (const { id: exhibitionId } of enabled.docs) {
    signal.throwIfAborted();
    const access = doc(db, 'exhibitionAccess', exhibitionId);
    const current = (await getDocFromServer(access)).data();
    const activeRevision = /^(?:v2-)?([1-9][0-9]*)$/.exec(current?.generationId ?? '')?.[1];
    if (!current?.enabled || !activeRevision) continue;

    const obsolete = await getDocsFromServer(query(collection(access, 'generations'),
      where('revision', '<', Number(activeRevision)), limit(1)));
    const generation = obsolete.docs[0] ?? (Number(current.contentRevision) > Number(activeRevision)
      ? (await getDocsFromServer(query(collection(access, 'generations'),
        where('revision', '>', Number(activeRevision)), where('revision', '<', current.contentRevision), limit(1)))).docs[0]
      : undefined);
    if (!generation) continue;
    const children = await Promise.all(['names', 'profiles'].map(kind =>
      getDocsFromServer(query(collection(generation.ref, kind), limit(32)))));
    const entries = children.flatMap(snapshot => snapshot.docs);
    let bytes = 0;
    const removals = entries.filter(entry => {
      bytes += serializedBytes(entry.data());
      return bytes <= 256 * 1024;
    });
    // Make progress even if one unusually large document exceeds the estimated byte budget.
    if (!removals.length && entries[0]) removals.push(entries[0]);
    await runTransaction(db, async transaction => {
      const [state, live] = await Promise.all([transaction.get(maintenance), transaction.get(access)]);
      signal.throwIfAborted();
      if (state.data()?.day === day || live.data()?.generationId !== current.generationId) return;
      for (const entry of removals) transaction.delete(entry.ref);
      // A full query page might have more children. Check again on a later day.
      if (removals.length === entries.length && children.every(snapshot => snapshot.size < 32)) {
        transaction.delete(generation.ref);
      }
      transaction.set(maintenance, { day });
    });
    return;
  }
}

type SyncStep = '원본 조회' | '변경 확인' | '전시 데이터 생성' | '전시 데이터 저장' | '공개 전환';
type SyncOutcome = 'current' | 'published' | 'pending';
type RecordWrite = { ref: DocumentReference; data?: DocumentData; bytes: number };

function canonical(data: unknown): string {
  if (Array.isArray(data)) return `[${data.map(canonical).join(',')}]`;
  if (data && typeof data === 'object') {
    return `{${Object.entries(data).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(',')}}`;
  }
  return JSON.stringify(data) ?? 'null';
}

function serializedBytes(data: unknown) {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

const sourceProjection = {
  sessions(snapshot: QueryDocumentSnapshot) {
    const session = snapshot.data() as Session;
    return {
      date: session.date,
      groups: (session.groups ?? []).map(group => ({ id: group.id ?? '', memberIds: group.memberIds ?? [], gameIds: group.gameIds ?? [] })),
    };
  },
  members(snapshot: QueryDocumentSnapshot) {
    const member = snapshot.data() as Member;
    return { id: snapshot.id, name: member.name ?? '', yearLabel: normalizeStudentYear(member.studentId ?? '') };
  },
  games(snapshot: QueryDocumentSnapshot) {
    return { id: snapshot.id, title: String(snapshot.data().title ?? '') };
  },
};

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
  reportOutcome?: (outcome: SyncOutcome) => void,
): Promise<boolean> {
  let step: SyncStep = '원본 조회';
  try {
    const outcome = await withFirestoreDeadline(deadline => {
      const signal = lifecycle ? AbortSignal.any([deadline, lifecycle]) : deadline;
      signal.throwIfAborted();
      return reconcile(signal, value => { step = value; });
    }, 45_000);
    reportOutcome?.(outcome);
    return outcome !== 'pending';
  } catch (error) {
    reportError?.(syncError(step, error));
    throw error;
  }
}

async function reconcile(signal: AbortSignal, reportStep: (step: SyncStep) => void): Promise<SyncOutcome> {
  const revisionRef = exhibitionRevisionRef();
  const source = (await getDocFromServer(revisionRef)).data();
  signal.throwIfAborted();
  const observedRevision = Number(source?.revision ?? 0);
  const progressRef = doc(db, 'exhibitionSync', 'progress');
  const settings = await getDocsFromServer(collection(db, 'exhibitionSettings'));
  signal.throwIfAborted();
  const active = settings.docs.filter(snapshot => (snapshot.data() as ExhibitionSettings).enabled)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const [sessionSnapshot, memberSnapshot, gameSnapshot] = active.length ? await Promise.all([
    getDocsFromServer(collection(db, 'sessions')),
    getDocsFromServer(collection(db, 'members')),
    getDocsFromServer(collection(db, 'games')),
  ]) : [null, null, null];
  signal.throwIfAborted();
  const sessions = (sessionSnapshot?.docs ?? []).map(sourceProjection.sessions);
  const members = (memberSnapshot?.docs ?? []).map(sourceProjection.members);
  const games = (gameSnapshot?.docs ?? []).map(sourceProjection.games);
  const defaults = new Map(games.map(({ id, title }) => [id, defaultExhibitionPin(id, title)]));
  const payload = new TextEncoder().encode(canonical([sessions, members, games]));
  const fingerprint = 'projection-v5:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', payload)),
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
  }).catch(async error => {
    if (syncError('변경 확인', error).code !== 'permission-denied') throw error;
    const latest = (await getDocFromServer(revisionRef)).data();
    signal.throwIfAborted();
    // Rules may reject the obsolete increment before Firestore reports a transaction conflict.
    if (Number(latest?.revision ?? 0) !== observedRevision) return null;
    throw error;
  });
  signal.throwIfAborted();
  if (revision === null) return 'pending';
  if (!revision) return 'current';

  const progress = await getDocFromServer(progressRef);
  signal.throwIfAborted();
  if (Number(progress.data()?.revision ?? 0) >= revision) return 'current';

  reportStep('전시 데이터 생성');
  const generationId = String(revision);
  const exhibits = await Promise.all(active.map(async snapshot => {
    const settings = snapshot.data() as ExhibitionSettings;
    const { period, gameMapping } = settings;
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
    const diagnostics = doc(db, 'exhibitionDiagnostics', snapshot.id);
    const [accessSnapshot, diagnosticsSnapshot] = await Promise.all([getDocFromServer(access), getDocFromServer(diagnostics)]);
    const oldAccess = accessSnapshot.data();
    const currentId = oldAccess?.enabled && oldAccess.generationId ? String(oldAccess.generationId) : '';
    const delta = currentId ? await comparePublishedRecords(access, currentId, result, signal) : [];
    const summary = {
      unmappedGameIds: result.unmappedGameIds.filter(id => !excluded.has(id)),
      missingMemberIds: result.missingMemberIds, profileCount: result.profiles.size,
      publishedGameKeys: gameKeysInProfiles(result.profiles.values()),
    };
    const oldDiagnostics = diagnosticsSnapshot.data();
    const summaryChanged = Object.entries(summary).some(([key, value]) => canonical(oldDiagnostics?.[key]) !== canonical(value));
    return { settings: snapshot.ref, access, currentId, delta, result, diagnostics, summary, summaryChanged,
      currentContentRevision: oldAccess?.contentRevision ?? (Number(currentId.replace(/^v2-/, '')) || 0) };
  }));
  signal.throwIfAborted();

  const staging = doc(db, 'exhibitionSync', 'staging');
  const delta = exhibits.flatMap(exhibit => exhibit.delta);
  const stageState = (await getDocFromServer(staging)).data();
  const full = stageState?.revision === revision || exhibits.some(exhibit => !exhibit.currentId) || delta.length > 80 ||
    delta.reduce((bytes, write) => bytes + write.bytes, 0) > 2 * 1024 * 1024;
  let stagedTotal = 0;
  if (full) {
    const operations = exhibits.flatMap(({ access, result }) => {
      const root = doc(access, 'generations', generationId);
      const writes: { ref: DocumentReference; data: DocumentData }[] = [{ ref: root, data: { revision } }];
      for (const kind of ['names', 'profiles'] as const) {
        for (const [id, data] of [...result[kind]].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
          writes.push({ ref: doc(root, kind, id), data });
        }
      }
      return writes;
    });
    stagedTotal = operations.length;
    reportStep('전시 데이터 저장');
    for (let offset = 0; offset < operations.length;) {
      signal.throwIfAborted();
      let end = offset;
      let bytes = 0;
      do {
        bytes += serializedBytes(operations[end]!.data);
        end++;
      } while (end < operations.length && end - offset < 80 && bytes < 1024 * 1024);
      const next = await runTransaction(db, async transaction => {
        const [current, applied, stage] = await Promise.all([
          transaction.get(revisionRef), transaction.get(progressRef), transaction.get(staging),
        ]);
        signal.throwIfAborted();
        if (current.data()?.revision !== revision) return null;
        if (Number(applied.data()?.revision ?? 0) >= revision) return operations.length;
        const cursor = stage.data()?.revision === revision ? Number(stage.data()?.offset ?? 0) : 0;
        if (cursor > offset) return cursor;
        if (cursor !== offset) return null;
        for (const { ref, data } of operations.slice(offset, end)) transaction.set(ref, data);
        transaction.set(staging, { revision, offset: end });
        return end;
      });
      if (next === null) return 'pending';
      offset = next;
    }
  }

  reportStep('공개 전환');
  signal.throwIfAborted();
  return runTransaction(db, async transaction => {
    const [current, applied, stage, ...settings] = await Promise.all([
      transaction.get(revisionRef), transaction.get(progressRef), transaction.get(staging),
      ...exhibits.map(exhibit => transaction.get(exhibit.settings)),
    ]);
    signal.throwIfAborted();
    if (current.data()?.revision !== revision) return 'pending';
    if (Number(applied.data()?.revision ?? 0) >= revision) return 'current';
    if (!full && stage.data()?.revision === revision) return 'pending';
    if (full && (stage.data()?.revision !== revision || stage.data()?.offset !== stagedTotal)) return 'pending';
    const saved = settings.map(snapshot => snapshot.data() as ExhibitionSettings | undefined);
    if (saved.some(settings => !settings?.enabled)) return 'pending';
    let published = false;
    for (const [index, exhibit] of exhibits.entries()) {
      const currentSettings = saved[index]!;
      const window = publicationWindow(currentSettings);
      if (full || exhibit.delta.length) {
        transaction.set(exhibit.access, { enabled: true, generationId: full ? generationId : exhibit.currentId,
          contentRevision: revision, descriptions: currentSettings.descriptions ?? {}, ...window });
        if (!full) for (const write of exhibit.delta) {
          if (write.data) transaction.set(write.ref, write.data);
          else transaction.delete(write.ref);
        }
        transaction.set(exhibit.diagnostics, { ...exhibit.summary, revision, syncedAt: serverTimestamp() });
        published = true;
      } else if (exhibit.summaryChanged) {
        transaction.set(exhibit.diagnostics, { ...exhibit.summary, revision: exhibit.currentContentRevision }, { merge: true });
      }
    }
    transaction.set(progressRef, { revision });
    return published ? 'published' : 'current';
  }).catch(async (error): Promise<SyncOutcome> => {
    if (syncError('공개 전환', error).code !== 'permission-denied') throw error;
    const [latest, applied] = await Promise.all([getDocFromServer(revisionRef), getDocFromServer(progressRef)]);
    signal.throwIfAborted();
    if (Number(applied.data()?.revision ?? 0) >= revision) return 'current';
    if (latest.data()?.revision !== revision) return 'pending';
    throw error;
  });
}

async function comparePublishedRecords(access: DocumentReference, currentId: string,
  result: Awaited<ReturnType<typeof buildExhibitionCollection>>, signal: AbortSignal): Promise<RecordWrite[]> {
  const root = doc(access, 'generations', currentId);
  const [names, profiles] = await Promise.all([
    getDocsFromServer(collection(root, 'names')), getDocsFromServer(collection(root, 'profiles')),
  ]);
  signal.throwIfAborted();
  const delta: RecordWrite[] = [];
  for (const [kind, snapshot] of [['names', names], ['profiles', profiles]] as const) {
    const previous = new Map(snapshot.docs.map(item => [item.id, item]));
    for (const [id, data] of result[kind]) {
      const old = previous.get(id)?.data();
      if (canonical(old) !== canonical(data)) {
        delta.push({ ref: doc(root, kind, id), data, bytes: serializedBytes(data) + serializedBytes(old ?? {}) });
      }
      previous.delete(id);
    }
    for (const item of previous.values()) delta.push({ ref: item.ref, bytes: serializedBytes(item.data()) });
  }
  return delta;
}

export type ExhibitionSyncStatus = 'idle' | 'current' | 'syncing' | 'pending' | 'error' | 'quota';

export function watchExhibitionSync(
  setStatus: (status: ExhibitionSyncStatus) => void,
  setError: (failure: ExhibitionSyncError | null) => void,
  watch: 'sources' | 'requests',
) {
  const controller = new AbortController();
  let stopped = false;
  let running = false;
  let requested = false;
  let manual = false;
  let failures = 0;
  let quotaPauseUntil = 0;
  let retryPauseUntil = 0;
  let lastScanAt = 0;
  let cleanupDay: string | undefined;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function schedule(delay = 500) {
    if (stopped) return;
    requested = true;
    if (running) return;
    clearTimeout(retry);
    retry = setTimeout(() => { void run(); }, Math.max(delay, quotaPauseUntil - Date.now(), retryPauseUntil - Date.now()));
  }

  function deferCleanup() {
    const day = pacificDay();
    if (cleanupDay === day || cleanupTimer) return;
    cleanupTimer = setTimeout(() => {
      cleanupTimer = undefined;
      if (stopped || Date.now() < quotaPauseUntil) return;
      const runDay = pacificDay();
      cleanupDay = runDay;
      void withFirestoreDeadline(deadline => pruneSupersededGeneration(
        AbortSignal.any([controller.signal, deadline]), runDay)).catch(error => {
        if (!stopped) console.warn('Exhibition cleanup deferred.', syncError('이전 데이터 정리', error));
      });
    }, 15 * 60_000);
  }

  async function run() {
    running = true;
    lastScanAt = Date.now();
    requested = false;
    setStatus('syncing');
    let done = false;
    let outcome: SyncOutcome | undefined;
    let failure: ExhibitionSyncError | undefined;
    try {
      done = await refreshExhibitions(error => { failure = error; }, controller.signal, result => { outcome = result; });
      failures = 0;
      quotaPauseUntil = 0;
      retryPauseUntil = 0;
    } catch {
      failures++;
      if (failure?.code === 'resource-exhausted') quotaPauseUntil = Date.now() + 30 * 60_000;
      else if (failures >= 3) retryPauseUntil = Date.now() + 15 * 60_000;
    } finally {
      running = false;
      if (!stopped) {
        setError(failure ?? null);
        setStatus(Date.now() < quotaPauseUntil ? 'quota' : failure ? 'error' : done
          ? manual && outcome === 'current' ? 'current' : 'idle' : 'pending');
        if (done) { manual = false; deferCleanup(); }
        if (requested || !done) schedule(requested ? 500 : Math.min(15_000 * 2 ** Math.min(failures, 3), 120_000));
      }
    }
  }

  let monitorFailed = false;
  const watches = (watch === 'requests' ? [] : (['sessions', 'members', 'games'] as const)).map(path => {
    let inputs: string | undefined;
    return onSnapshot(collection(db, path), { includeMetadataChanges: true }, snapshot => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const next = JSON.stringify(snapshot.docs.map(item => sourceProjection[path](item)));
      if (next !== inputs) schedule(2_000);
      inputs = next;
    }, error => {
      monitorFailed = true;
      if (stopped) return;
      setError(syncError('원본 변경 감시', error));
      if (Date.now() >= quotaPauseUntil) setStatus('error');
      schedule();
    });
  });
  if (watch === 'requests') {
    watches.push(onSnapshot(exhibitionRevisionRef(), { includeMetadataChanges: true }, snapshot => {
      if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) schedule();
    }, error => {
      monitorFailed = true;
      if (stopped) return;
      setError(syncError('동기화 요청 감시', error));
      if (Date.now() >= quotaPauseUntil) setStatus('error');
      schedule();
    }));
  }
  // A listener can terminate on temporary permission changes. Keep reconciliation
  // available until the administrator reopens the page and attaches new listeners.
  const recovery = setInterval(() => { if (monitorFailed) schedule(); }, 120_000);
  const onReconnect = () => schedule();
  const onFocus = () => { if (Date.now() - lastScanAt >= 120_000) schedule(); };
  window.addEventListener('online', onReconnect);
  window.addEventListener('focus', onFocus);
  schedule(watch === 'sources' ? 2_000 : 500);
  function stop() {
    stopped = true;
    controller.abort();
    clearTimeout(retry);
    clearTimeout(cleanupTimer);
    clearInterval(recovery);
    watches.forEach(unsubscribe => unsubscribe());
    window.removeEventListener('online', onReconnect);
    window.removeEventListener('focus', onFocus);
  }
  return { stop, request: (fromButton = true) => { manual ||= fromButton; schedule(0); } };
}

import { withFirestoreDeadline } from '../lib/firestoreDeadline';
import {
  Bytes, collection, deleteField, doc, getDocFromServer, getDocsFromServer, limit, onSnapshot, query, where, runTransaction,
  serverTimestamp, Timestamp, type DocumentData, type DocumentReference, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { buildExhibitionCollection, exhibitionNameKey, exhibitionProfileKey, exhibitionSessionKey,
  type ExhibitionParticipation, type ExhibitionPeriod, type ExhibitionProfile, type PublicExhibitionSession } from '../domain/exhibition/collection';
import {
  defaultExhibitionPin, exhibitionPins, exhibitionPublicationWindow, fallbackExhibitionPin, isExhibitionImageUpload, maxExhibitionImageBytes,
  type ExhibitionCopy, type ExhibitionSchedule, type ExhibitionVisibility,
} from '../domain/exhibition/presentation';
import { normalizeStudentYear } from '../domain/members/memberIdentity';
import { exhibitionRevisionRef, requestExhibitionRefresh } from './exhibitionRevision';
import { sessionAuditEventId, sessionAuditSequenceRef } from './sessionAuditSequence';
import type { AuditEvent } from '../domain/audit/auditEvent';
import type { Member, Session } from '../types';

export interface ExhibitionSettings {
  enabled: boolean;
  autoPublish?: boolean;
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
  const [source, progress, diagnostics, access, sequence, journal] = await withFirestoreDeadline(() => Promise.all([
    getDocFromServer(exhibitionRevisionRef()), getDocFromServer(doc(db, 'exhibitionSync', 'progress')),
    getDocFromServer(doc(db, 'exhibitionDiagnostics', exhibitionId)),
    getDocFromServer(doc(db, 'exhibitionAccess', exhibitionId)),
    getDocFromServer(sessionAuditSequenceRef()), getDocFromServer(doc(db, 'exhibitionSync', 'journal')),
  ]));
  const active = access.data();
  const diagnostic = diagnostics.data();
  const generationId = active?.enabled === true && typeof active.generationId === 'string' && active.generationId
    ? active.generationId : undefined;
  const contentRevision = active?.contentRevision ?? Number(generationId);
  return {
    pending: Number(source.data()?.revision ?? 0) > Number(progress.data()?.revision ?? 0) ||
      Number(sequence.data()?.sequence ?? 0) > Number(journal.data()?.sequence ?? 0),
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
    if (snapshot.docs.some(profile => Array.isArray(profile.data().sessionIds))) {
      const sessions = await getDocsFromServer(collection(profiles.parent!, 'sessions'));
      signal.throwIfAborted();
      return [...new Set(sessions.docs.flatMap(session => (session.data() as PublicExhibitionSession).groups
        .flatMap(group => group.gameIds)))].sort();
    }
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
    const nextSettings = previous?.autoPublish === undefined ? settings
      : { ...settings, autoPublish: settings.autoPublish ?? previous.autoPublish };
    if (canonical(previous) !== canonical(nextSettings)) transaction.set(settingsRef, nextSettings);
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
    const children = await Promise.all(['names', 'profiles', 'sessions'].map(kind =>
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

async function fingerprintOf(data: unknown) {
  const payload = new TextEncoder().encode(canonical(data));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', payload)), byte => byte.toString(16).padStart(2, '0')).join('');
}

type Catalog = { members: ReturnType<typeof sourceProjection.members>[]; games: ReturnType<typeof sourceProjection.games>[] };
type Journal = { revision: number; sequence: number; catalog: string; gameCounts: Record<string, number> };

function exhibitionGameCatalog(games: Catalog['games'], settings: ExhibitionSettings) {
  const excluded = new Set(settings.gameMapping.filter(({ pinId }) => pinId === '').map(({ sourceId }) => sourceId));
  const mapping = new Map(games.map(({ id, title }) => [id, defaultExhibitionPin(id, title)]));
  for (const { sourceId, pinId } of settings.gameMapping) {
    if (Object.hasOwn(exhibitionPins, pinId) || pinId === fallbackExhibitionPin(sourceId)) mapping.set(sourceId, pinId);
    else mapping.delete(sourceId);
  }
  const titles = new Map(games.filter(game => game.title.trim() && !excluded.has(game.id)).map(({ id, title }) => [id, title.trim()]));
  return { excluded, mapping, titles };
}

function sessionGames(session: PublicExhibitionSession | undefined) {
  return new Set(session?.groups.flatMap(group => group.gameIds) ?? []);
}

function countSessionGames(sessions: Iterable<PublicExhibitionSession>) {
  const counts: Record<string, number> = {};
  for (const session of sessions) for (const id of sessionGames(session)) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

const sourceProjection = {
  sessions(snapshot: QueryDocumentSnapshot) {
    const session = snapshot.data() as Session;
    return {
      id: snapshot.id,
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
  scanForLegacyWrites = true,
): Promise<boolean> {
  let step: SyncStep = '원본 조회';
  try {
    const outcome = await withFirestoreDeadline(deadline => {
      const signal = lifecycle ? AbortSignal.any([deadline, lifecycle]) : deadline;
      signal.throwIfAborted();
      return reconcile(signal, value => { step = value; }, scanForLegacyWrites);
    }, 45_000);
    reportOutcome?.(outcome);
    return outcome !== 'pending';
  } catch (error) {
    reportError?.(syncError(step, error));
    throw error;
  }
}

async function reconcile(signal: AbortSignal, reportStep: (step: SyncStep) => void, scanForLegacyWrites: boolean): Promise<SyncOutcome> {
  const revisionRef = exhibitionRevisionRef();
  const journalRef = doc(db, 'exhibitionSync', 'journal');
  const sequenceRef = sessionAuditSequenceRef();
  const [sourceSnapshot, sequenceSnapshot, journalSnapshot] = await Promise.all([
    getDocFromServer(revisionRef), getDocFromServer(sequenceRef), getDocFromServer(journalRef),
  ]);
  const source = sourceSnapshot.data();
  const sequence = Number(sequenceSnapshot.data()?.sequence ?? 0);
  const journal = journalSnapshot.data() as Journal | undefined;
  signal.throwIfAborted();
  const observedRevision = Number(source?.revision ?? 0);
  const progressRef = doc(db, 'exhibitionSync', 'progress');
  const settings = await getDocsFromServer(collection(db, 'exhibitionSettings'));
  signal.throwIfAborted();
  const active = settings.docs.filter(snapshot => (snapshot.data() as ExhibitionSettings).enabled)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const [memberSnapshot, gameSnapshot] = active.length ? await Promise.all([
    getDocsFromServer(collection(db, 'members')),
    getDocsFromServer(collection(db, 'games')),
  ]) : [null, null];
  signal.throwIfAborted();
  const members = (memberSnapshot?.docs ?? []).map(sourceProjection.members);
  const games = (gameSnapshot?.docs ?? []).map(sourceProjection.games);
  const catalog = await fingerprintOf([members, games, active.map(item => [item.id, recordSettingsKey(item.data() as ExhibitionSettings)])]);
  const only = active.length === 1 ? active[0] : undefined;
  if (only && journal?.revision === observedRevision && journal.catalog === catalog) {
    if (!scanForLegacyWrites && sequence === journal.sequence) return 'current';
    if (sequence > journal.sequence && sequence - journal.sequence <= 8) {
      const outcome = await publishSessionChanges(only, { members, games }, journal, sequence, signal, reportStep);
      if (outcome) return outcome;
    }
  }
  const sessionSnapshot = active.length ? await getDocsFromServer(collection(db, 'sessions')) : undefined;
  const sessions = (sessionSnapshot?.docs ?? []).map(sourceProjection.sessions);
  const fingerprint = 'projection-v6:' + await fingerprintOf([sessions, members, games]);
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
  if (Number(progress.data()?.revision ?? 0) >= revision) {
    if (journal?.revision === revision && journal.catalog === catalog && sequence > journal.sequence) {
      return runTransaction(db, async transaction => {
        const [head, saved] = await Promise.all([transaction.get(sequenceRef), transaction.get(journalRef)]);
        signal.throwIfAborted();
        if (Number(head.data()?.sequence ?? 0) !== sequence || saved.data()?.revision !== revision) return 'pending';
        if (Number(saved.data()?.sequence ?? 0) < sequence) transaction.set(journalRef, { ...journal, sequence });
        return 'current';
      });
    }
    return 'current';
  }

  reportStep('전시 데이터 생성');
  const generationId = String(revision);
  const exhibits = await Promise.all(active.map(async snapshot => {
    const settings = snapshot.data() as ExhibitionSettings;
    const { period } = settings;
    const { excluded, mapping, titles: titlesBySourceId } = exhibitionGameCatalog(games, settings);
    const result = await buildExhibitionCollection(snapshot.id, period, sessions, members,
      mapping, titlesBySourceId);
    const access = doc(db, 'exhibitionAccess', snapshot.id);
    const diagnostics = doc(db, 'exhibitionDiagnostics', snapshot.id);
    const [accessSnapshot, diagnosticsSnapshot] = await Promise.all([getDocFromServer(access), getDocFromServer(diagnostics)]);
    const oldAccess = accessSnapshot.data();
    const currentId = oldAccess?.enabled && oldAccess.generationId && oldAccess.format === 'sessions-v1' ? String(oldAccess.generationId) : '';
    const delta = currentId ? await comparePublishedRecords(access, currentId, result, signal) : [];
    const summary = {
      unmappedGameIds: result.unmappedGameIds.filter(id => !excluded.has(id)),
      missingMemberIds: result.missingMemberIds, profileCount: result.profiles.size,
      publishedGameKeys: gameKeysInProfiles(result.profiles.values()),
    };
    const oldDiagnostics = diagnosticsSnapshot.data();
    const summaryChanged = Object.entries(summary).some(([key, value]) => canonical(oldDiagnostics?.[key]) !== canonical(value));
    const presentationChanged = canonical(oldAccess?.gameTitles) !== canonical(result.gameTitles) ||
      canonical(oldAccess?.gamePins) !== canonical(result.gamePins);
    return { settings: snapshot.ref, access, currentId, delta, result, diagnostics, summary, summaryChanged, presentationChanged,
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
      for (const [kind, records] of [['names', result.names], ['profiles', result.participation], ['sessions', result.publicSessions]] as const) {
        for (const [id, data] of [...records].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
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
    const [current, applied, stage, head, ...settings] = await Promise.all([
      transaction.get(revisionRef), transaction.get(progressRef), transaction.get(staging), transaction.get(sequenceRef),
      ...exhibits.map(exhibit => transaction.get(exhibit.settings)),
    ]);
    signal.throwIfAborted();
    if (current.data()?.revision !== revision) return 'pending';
    if (Number(head.data()?.sequence ?? 0) !== sequence) return 'pending';
    if (Number(applied.data()?.revision ?? 0) >= revision) return 'current';
    if (!full && stage.data()?.revision === revision) return 'pending';
    if (full && (stage.data()?.revision !== revision || stage.data()?.offset !== stagedTotal)) return 'pending';
    const saved = settings.map(snapshot => snapshot.data() as ExhibitionSettings | undefined);
    if (saved.some(settings => !settings?.enabled)) return 'pending';
    let published = false;
    for (const [index, exhibit] of exhibits.entries()) {
      const currentSettings = saved[index]!;
      const window = publicationWindow(currentSettings);
      if (full || exhibit.delta.length || exhibit.presentationChanged) {
        transaction.set(exhibit.access, { enabled: true, generationId: full ? generationId : exhibit.currentId,
          contentRevision: revision, format: 'sessions-v1', gameTitles: exhibit.result.gameTitles, gamePins: exhibit.result.gamePins,
          descriptions: currentSettings.descriptions ?? {}, ...window });
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
    if (exhibits.length === 1) transaction.set(journalRef, {
      revision, sequence, catalog, gameCounts: countSessionGames(exhibits[0]!.result.publicSessions.values()),
    } satisfies Journal);
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

async function publishSessionChanges(settingsSnapshot: QueryDocumentSnapshot, catalog: Catalog, journal: Journal,
  sequence: number, signal: AbortSignal, reportStep: (step: SyncStep) => void): Promise<SyncOutcome | undefined> {
  const exhibitionId = settingsSnapshot.id;
  const settings = settingsSnapshot.data() as ExhibitionSettings;
  const { excluded, mapping, titles } = exhibitionGameCatalog(catalog.games, settings);
  const knownGame = (id: string) => {
    const pin = mapping.get(id);
    return excluded.has(id) || Boolean(pin && !pin.startsWith('game-'));
  };
  const knownMembers = new Set(catalog.members.filter(member => member.name.trim()).map(member => member.id));
  const validGroup = (group: { memberIds: string[]; gameIds: string[] }) =>
    group.memberIds.every(id => knownMembers.has(id)) && group.gameIds.every(knownGame);
  const ids = new Set<string>();
  for (const event of await Promise.all(Array.from({ length: sequence - journal.sequence }, (_, index) =>
    getDocFromServer(doc(db, 'auditEvents', sessionAuditEventId(journal.sequence + index + 1)))))) {
    const data = event.data() as AuditEvent | undefined;
    const change = data?.exhibitionChange;
    if (!change) return;
    if (change.kind === 'imported') {
      for (const id of change.sessionIds) ids.add(id);
    } else {
      if (!data?.targetId) return;
      if ('session' in change && !change.session.groups.every(validGroup)) return;
      if (change.kind === 'updated' && change.groups.some(group => 'group' in group ? !validGroup(group.group) :
        [...(group.members?.added ?? []), ...(group.members?.removed ?? [])].some(id => !knownMembers.has(id)) ||
        [...(group.games?.added ?? []), ...(group.games?.removed ?? [])].some(id => !knownGame(id)))) return;
      ids.add(data.targetId);
    }
  }
  if (ids.size > 8) return;

  const accessRef = doc(db, 'exhibitionAccess', exhibitionId);
  const access = (await getDocFromServer(accessRef)).data();
  if (access?.format !== 'sessions-v1' || !access.enabled || !access.generationId) return;
  const gameCounts = { ...journal.gameCounts };
  const gameTitles = { ...access.gameTitles };
  const gamePins = { ...access.gamePins };
  const writes = await Promise.all([...ids].map(async id => {
    const key = await exhibitionSessionKey(exhibitionId, id);
    const ref = doc(accessRef, 'generations', access.generationId, 'sessions', key);
    const [current, published] = await Promise.all([getDocFromServer(doc(db, 'sessions', id)), getDocFromServer(ref)]);
    const sessions = current.exists() ? [{ ...(current.data() as Session), id }] : [];
    if (sessions.some(session => !(session.groups ?? []).every(validGroup))) return null;
    const result = await buildExhibitionCollection(exhibitionId, settings.period, sessions, catalog.members, mapping, titles);
    const before = published.data() as PublicExhibitionSession | undefined;
    const after = result.publicSessions.get(key);
    return { ref, key, before, after, gameTitles: result.gameTitles, gamePins: result.gamePins };
  }));
  if (writes.some(write => write === null)) return;
  signal.throwIfAborted();
  const changed = writes.flatMap(write => write && canonical(write.before) !== canonical(write.after) ? [write] : []);
  const links = new Map<string, { add: string[]; remove: string[] }>();
  const participants = (session: PublicExhibitionSession | undefined) =>
    new Set(session?.groups.flatMap(group => group.participants.map(member => member.profileId)) ?? []);
  for (const write of changed) {
    const before = sessionGames(write.before);
    const after = sessionGames(write.after);
    for (const key of before) if (!after.has(key)) gameCounts[key] = (gameCounts[key] ?? 0) - 1;
    for (const key of after) if (!before.has(key)) gameCounts[key] = (gameCounts[key] ?? 0) + 1;
    Object.assign(gameTitles, write.gameTitles);
    Object.assign(gamePins, write.gamePins);
    const beforeMembers = participants(write.before);
    const afterMembers = participants(write.after);
    for (const id of new Set([...beforeMembers, ...afterMembers])) {
      if (beforeMembers.has(id) === afterMembers.has(id)) continue;
      const link = links.get(id) ?? { add: [], remove: [] };
      (afterMembers.has(id) ? link.add : link.remove).push(write.key);
      links.set(id, link);
    }
  }
  // Each link can also require an exact-name index write. Send larger changes through staging.
  if (links.size > 32) return;
  for (const [key, count] of Object.entries(gameCounts)) if (count <= 0) {
    delete gameCounts[key];
    delete gameTitles[key];
    delete gamePins[key];
  }
  const revisionRef = exhibitionRevisionRef();
  const sequenceRef = sessionAuditSequenceRef();
  const journalRef = doc(db, 'exhibitionSync', 'journal');
  const progressRef = doc(db, 'exhibitionSync', 'progress');
  const diagnostics = doc(db, 'exhibitionDiagnostics', exhibitionId);
  const root = doc(accessRef, 'generations', access.generationId);
  const memberDetails = new Map(links.size ? await Promise.all(catalog.members.map(async member =>
    [await exhibitionProfileKey(exhibitionId, member.id), member] as const)) : []);
  reportStep('공개 전환');
  return runTransaction(db, async transaction => {
    const [source, head, savedJournal, live, savedSettings, savedDiagnostics] = await Promise.all([
      transaction.get(revisionRef), transaction.get(sequenceRef), transaction.get(journalRef),
      transaction.get(accessRef), transaction.get(settingsSnapshot.ref),
      transaction.get(diagnostics),
    ]);
    signal.throwIfAborted();
    if (source.data()?.revision !== journal.revision || head.data()?.sequence !== sequence ||
      savedJournal.data()?.sequence !== journal.sequence || live.data()?.generationId !== access.generationId ||
      live.data()?.contentRevision !== access.contentRevision || !savedSettings.exists() ||
      recordSettingsKey(savedSettings.data() as ExhibitionSettings) !== recordSettingsKey(settings)) return 'pending';
    const linkUpdates = await Promise.all([...links].map(async ([id, link]) => {
      const ref = doc(root, 'profiles', id);
      const before = (await transaction.get(ref)).data() as ExhibitionParticipation | undefined;
      const sessionIds = new Set(before?.sessionIds ?? []);
      for (const key of link.remove) sessionIds.delete(key);
      for (const key of link.add) sessionIds.add(key);
      const name = memberDetails.get(id)!.name;
      return { ref, id, name, before, after: sessionIds.size ? { name, sessionIds: [...sessionIds].sort() } : undefined };
    }));
    const names = new Map<string, { add: string[]; remove: string[] }>();
    let profileCount = Number(savedDiagnostics.data()?.profileCount ?? 0);
    for (const update of linkUpdates) {
      if (Boolean(update.before) === Boolean(update.after)) continue;
      profileCount += update.after ? 1 : -1;
      const key = (await exhibitionNameKey(update.name))!;
      const changes = names.get(key) ?? { add: [], remove: [] };
      (update.after ? changes.add : changes.remove).push(update.id);
      names.set(key, changes);
    }
    const nameUpdates = await Promise.all([...names].map(async ([key, changes]) => {
      const ref = doc(root, 'names', key);
      const existing = (await transaction.get(ref)).data()?.candidates as { profileId: string }[] | undefined;
      const ids = new Set(existing?.map(candidate => candidate.profileId));
      for (const id of changes.remove) ids.delete(id);
      for (const id of changes.add) ids.add(id);
      const candidates = [...ids].sort((a, b) => memberDetails.get(a)!.id.localeCompare(memberDetails.get(b)!.id))
        .map(profileId => {
          const yearLabel = memberDetails.get(profileId)?.yearLabel;
          return { profileId, ...(ids.size > 1 && yearLabel && /^\d{2}$/u.test(yearLabel) ? { yearLabel } : {}) };
        });
      return { ref, data: candidates.length ? { candidates } : undefined };
    }));
    signal.throwIfAborted();
    const revision = changed.length ? journal.revision + 1 : journal.revision;
    if (changed.length) {
      for (const write of changed) {
        if (write.after) transaction.set(write.ref, write.after);
        else transaction.delete(write.ref);
      }
      for (const update of linkUpdates) {
        if (update.after) transaction.set(update.ref, update.after);
        else transaction.delete(update.ref);
      }
      for (const update of nameUpdates) {
        if (update.data) transaction.set(update.ref, update.data);
        else transaction.delete(update.ref);
      }
      transaction.set(revisionRef, { revision, fingerprint: source.data()!.fingerprint });
      transaction.set(progressRef, { revision });
      transaction.update(accessRef, { contentRevision: revision, gameTitles, gamePins });
      transaction.set(diagnostics, { publishedGameKeys: Object.keys(gameCounts).sort(), profileCount, revision, syncedAt: serverTimestamp() }, { merge: true });
    }
    transaction.set(journalRef, { ...journal, revision, sequence, gameCounts });
    return changed.length ? 'published' : 'current';
  });
}

async function comparePublishedRecords(access: DocumentReference, currentId: string,
  result: Awaited<ReturnType<typeof buildExhibitionCollection>>, signal: AbortSignal): Promise<RecordWrite[]> {
  const root = doc(access, 'generations', currentId);
  const [names, profiles, sessions] = await Promise.all([
    getDocsFromServer(collection(root, 'names')), getDocsFromServer(collection(root, 'profiles')), getDocsFromServer(collection(root, 'sessions')),
  ]);
  signal.throwIfAborted();
  const delta: RecordWrite[] = [];
  for (const [kind, snapshot, records] of [
    ['names', names, result.names], ['profiles', profiles, result.participation], ['sessions', sessions, result.publicSessions],
  ] as const) {
    const previous = new Map(snapshot.docs.map(item => [item.id, item]));
    for (const [id, data] of records) {
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
  exhibitionId = import.meta.env.VITE_EXHIBITION_ID || 'avalon',
) {
  const controller = new AbortController();
  let stopped = false;
  let running = false;
  let requested = false;
  let manual = false;
  let automatic = false;
  let automaticRun: AbortController | undefined;
  let watches: (() => void)[] = [];
  let quotaTimer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let quotaPauseUntil = 0;
  let retryPauseUntil = 0;
  let lastScanAt = 0;
  let cleanupDay: string | undefined;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function schedule(delay = 500) {
    if (stopped || (!automatic && !manual)) return;
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
    if (stopped || (!automatic && !manual)) return;
    const fromButton = manual;
    const background = fromButton ? undefined : new AbortController();
    automaticRun = background;
    const signal = background ? AbortSignal.any([controller.signal, background.signal]) : controller.signal;
    running = true;
    lastScanAt = Date.now();
    requested = false;
    setStatus('syncing');
    let done = false;
    let outcome: SyncOutcome | undefined;
    let failure: ExhibitionSyncError | undefined;
    try {
      done = await refreshExhibitions(error => { failure = error; }, signal, result => { outcome = result; }, fromButton);
      failures = 0;
      quotaPauseUntil = 0;
      retryPauseUntil = 0;
      clearTimeout(quotaTimer);
    } catch {
      if (!signal.aborted) {
        failures++;
        if (failure?.code === 'resource-exhausted') {
          quotaPauseUntil = Date.now() + 30 * 60_000;
          clearTimeout(quotaTimer);
          quotaTimer = setTimeout(() => { if (!running) setStatus('error'); }, 30 * 60_000);
        } else if (failures >= 3) retryPauseUntil = Date.now() + 15 * 60_000;
      }
    } finally {
      automaticRun = undefined;
      running = false;
      if (!stopped) {
        setError(signal.aborted ? null : failure ?? null);
        setStatus(signal.aborted ? 'idle' : Date.now() < quotaPauseUntil ? 'quota' : failure ? 'error' : done
          ? fromButton && outcome === 'current' ? 'current' : 'idle' : 'pending');
        if (fromButton && (done || failure)) manual = false;
        if (done) deferCleanup();
        if (requested || (!signal.aborted && !done)) {
          schedule(requested ? 500 : Math.min(15_000 * 2 ** Math.min(failures, 3), 120_000));
        }
      }
    }
  }

  let monitorFailed = false;
  function monitorSources() {
    return (['members', 'games'] as const).map(path => {
      let inputs: string | undefined;
      return onSnapshot(collection(db, path), { includeMetadataChanges: true }, snapshot => {
        if (!automatic || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        const next = JSON.stringify(snapshot.docs.map(item => sourceProjection[path](item)));
        if (next !== inputs) schedule(2_000);
        inputs = next;
      }, error => {
        monitorFailed = true;
        if (stopped || !automatic) return;
        setError(syncError('원본 변경 감시', error));
        if (Date.now() >= quotaPauseUntil) setStatus('error');
        schedule();
      });
    });
  }
  function monitorRequests() {
    return onSnapshot(exhibitionRevisionRef(), { includeMetadataChanges: true }, snapshot => {
      if (automatic && !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) schedule();
    }, error => {
      monitorFailed = true;
      if (stopped || !automatic) return;
      setError(syncError('동기화 요청 감시', error));
      if (Date.now() >= quotaPauseUntil) setStatus('error');
      schedule();
    });
  }

  function monitorSessionChanges() {
    let sequence: number | undefined;
    return onSnapshot(sessionAuditSequenceRef(), { includeMetadataChanges: true }, snapshot => {
      if (!automatic || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const next = Number(snapshot.data()?.sequence ?? 0);
      if (next !== sequence) schedule(watch === 'sources' ? 2_000 : 500);
      sequence = next;
    }, error => {
      monitorFailed = true;
      if (stopped || !automatic) return;
      setError(syncError('세션 변경 감시', error));
      if (Date.now() >= quotaPauseUntil) setStatus('error');
      schedule();
    });
  }
  function setAutomatic(enabled: boolean) {
    if (stopped || automatic === enabled) return;
    automatic = enabled;
    if (enabled) {
      monitorFailed = false;
      watches = [monitorSessionChanges(), ...(watch === 'sources' ? monitorSources() : [monitorRequests()])];
      schedule(watch === 'sources' ? 2_000 : 500);
    } else {
      watches.forEach(unsubscribe => unsubscribe());
      watches = [];
      automaticRun?.abort();
      if (!manual) clearTimeout(retry);
    }
  }
  const stopSettings = onSnapshot(doc(db, 'exhibitionSettings', exhibitionId), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.hasPendingWrites) return;
    const settings = snapshot.data();
    setAutomatic(!snapshot.metadata.fromCache && settings?.autoPublish === true && settings.enabled === true);
  }, () => setAutomatic(false));
  // A listener can terminate on temporary permission changes. Keep reconciliation
  // available until the administrator reopens the page and attaches new listeners.
  const recovery = setInterval(() => { if (automatic && monitorFailed) schedule(); }, 120_000);
  const onReconnect = () => { if (automatic) schedule(); };
  const onFocus = () => { if (automatic && Date.now() - lastScanAt >= 120_000) schedule(); };
  window.addEventListener('online', onReconnect);
  window.addEventListener('focus', onFocus);
  function stop() {
    stopped = true;
    controller.abort();
    clearTimeout(retry);
    clearTimeout(cleanupTimer);
    clearTimeout(quotaTimer);
    clearInterval(recovery);
    stopSettings();
    watches.forEach(unsubscribe => unsubscribe());
    window.removeEventListener('online', onReconnect);
    window.removeEventListener('focus', onFocus);
  }
  return { stop, request: () => { manual = true; schedule(0); } };
}

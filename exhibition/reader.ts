import { Bytes, doc, getDocFromServer, onSnapshot, type DocumentData, type Firestore } from 'firebase/firestore';
import { exhibitionNameKey, type ExhibitionProfile } from '../src/domain/exhibition/collection';
import { exhibitionCopy, isExhibitionImageUpload, type ExhibitionCopy } from '../src/domain/exhibition/presentation';
import { withFirestoreDeadline } from '../src/lib/firestoreDeadline';

export async function readUploadedPinImage(db: Firestore, exhibitionId: string, key: string, version: string) {
  if (!isExhibitionImageUpload(version)) return;
  const snapshot = await getDocFromServer(doc(db, 'exhibitionPinAppearance', exhibitionId, 'exhibitionImages', key));
  const data = snapshot.data();
  if (data?.version === version && data.bytes instanceof Bytes) return 'data:image/webp;base64,' + data.bytes.toBase64();
}

export class ExhibitionUnavailable extends Error {}
export const exhibitionLookupBudget = 3_000;

interface Publication {
  id: string;
  contentRevision?: number;
  descriptions: Record<string, string>;
  images: Record<string, string>;
  gameTitles: Record<string, string>;
  endsAt: number | undefined;
}

function publication(data: DocumentData | undefined): Publication | null {
  if (data?.enabled !== true || typeof data.generationId !== 'string' || !data.generationId) return null;
  return { id: data.generationId, contentRevision: data.contentRevision, descriptions: data.descriptions ?? {}, images: data.images ?? {},
    gameTitles: data.gameTitles ?? {}, endsAt: data.endsAt?.toMillis() };
}

export function createExhibitionReader(db: Firestore, exhibitionId: string) {
  const access = doc(db, 'exhibitionAccess', exhibitionId);
  const appearance = doc(db, 'exhibitionPinAppearance', exhibitionId);
  let nameLookup: { publication: Publication; candidates: Set<string>; expiresAt: number } | undefined;
  let warmAccess: { request: Promise<Publication | null>; expiresAt: number } | undefined;
  let lookupRequest = 0;

  async function generation(signal: AbortSignal): Promise<Publication> {
    signal.throwIfAborted();
    try {
      const available = publication((await getDocFromServer(access)).data());
      signal.throwIfAborted();
      if (available) return available;
    } catch (error) {
      if ((error as { code?: string }).code !== 'permission-denied') throw error;
    }
    throw new ExhibitionUnavailable('현재 볼 수 있는 기록이 없습니다.');
  }

  async function readActive<T>(kind: 'names' | 'profiles', id: string, signal: AbortSignal, published?: Publication) {
    const first = published ?? await generation(signal);
    try {
      signal.throwIfAborted();
      const snapshot = await getDocFromServer(doc(access, 'generations', first.id, kind, id));
      signal.throwIfAborted();
      return { ...first, record: (snapshot.data() as T | undefined) ?? null, generationId: first.id };
    } catch (error) {
      if ((error as { code?: string }).code !== 'permission-denied') throw error;
      const next = await generation(signal);
      if (first.id === next.id) throw error;
      const snapshot = await getDocFromServer(doc(access, 'generations', next.id, kind, id));
      signal.throwIfAborted();
      return { ...next, record: (snapshot.data() as T | undefined) ?? null, generationId: next.id };
    }
  }

  function primeExhibitionNameLookup() {
    if (warmAccess && Date.now() < warmAccess.expiresAt) return;
    warmAccess = {
      request: withFirestoreDeadline(generation, exhibitionLookupBudget).catch(() => null),
      expiresAt: Date.now() + 30_000,
    };
  }

  function findExhibitionMembers(name: string) {
    const request = ++lookupRequest;
    nameLookup = undefined;
    const warm = warmAccess;
    warmAccess = undefined;
    return withFirestoreDeadline(async signal => {
      const id = await exhibitionNameKey(name);
      if (!id) return [];
      const primed = warm && Date.now() < warm.expiresAt ? await warm.request : null;
      const { record, ...published } = await readActive<{ candidates: { profileId: string; yearLabel?: string }[] }>(
        'names', id, signal, primed ?? undefined);
      const candidates = record?.candidates ?? [];
      if (request === lookupRequest && candidates.length) {
        nameLookup = { publication: published, candidates: new Set(candidates.map(candidate => candidate.profileId)),
          expiresAt: Math.min(Date.now() + 30_000, published.endsAt ?? Infinity) };
      }
      return candidates;
    }, exhibitionLookupBudget);
  }

  function loadExhibitionView(id: string, published?: Publication, deadline = exhibitionLookupBudget) {
    const lookup = nameLookup;
    nameLookup = undefined;
    const recent = lookup && lookup.candidates.has(id) && Date.now() < lookup.expiresAt ? lookup.publication : undefined;
    return withFirestoreDeadline(signal => readActive<ExhibitionProfile>('profiles', id, signal, published ?? recent), deadline);
  }

  const loadExhibitionProfile = async (id: string) => (await loadExhibitionView(id)).record;
  const watchExhibitionPublication = (change: (update: Publication | null) => void) =>
    onSnapshot(access, { includeMetadataChanges: true }, snapshot => {
      if (!snapshot.metadata.fromCache) change(publication(snapshot.data()));
    }, error => {
      if (error.code === 'permission-denied') change(null);
    });
  const watchExhibitionCopy = (change: (copy: ExhibitionCopy) => void) =>
    onSnapshot(doc(db, 'exhibitionCopy', exhibitionId), { includeMetadataChanges: true }, snapshot => {
      if (snapshot.metadata.fromCache) return;
      const saved = snapshot.data()?.copy ?? {};
      change(Object.fromEntries(Object.keys(exhibitionCopy).flatMap(key =>
        typeof saved[key] === 'string' && saved[key].trim() ? [[key, saved[key]]] : [])));
    }, () => {});
  const watchExhibitionAppearance = (change: (data: { descriptions: Record<string, string>; images: Record<string, string> }) => void) =>
    onSnapshot(appearance, { includeMetadataChanges: true }, snapshot => {
      const data = snapshot.data();
      if (!snapshot.metadata.fromCache && data) change({ descriptions: data.descriptions ?? {}, images: data.images ?? {} });
    }, () => {});
  return {
    primeExhibitionNameLookup, findExhibitionMembers, loadExhibitionProfile, loadExhibitionView,
    loadExhibitionPinImage: (key: string, version: string) => readUploadedPinImage(db, exhibitionId, key, version),
    watchExhibitionPublication, watchExhibitionCopy, watchExhibitionAppearance,
  };
}

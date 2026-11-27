import { doc, getDocFromServer, onSnapshot, type DocumentData, type Firestore } from 'firebase/firestore';
import { exhibitionNameKey, type ExhibitionProfile } from '../src/domain/exhibition/collection';
import { exhibitionCopy, type ExhibitionCopy } from '../src/domain/exhibition/presentation';

export class ExhibitionUnavailable extends Error {}

interface Publication {
  id: string;
  descriptions: Record<string, string>;
  images: Record<string, string>;
  gameTitles: Record<string, string>;
  endsAt: number | undefined;
}

function publication(data: DocumentData | undefined): Publication | null {
  if (data?.enabled !== true || typeof data.generationId !== 'string' || !data.generationId) return null;
  return { id: data.generationId, descriptions: data.descriptions ?? {}, images: data.images ?? {},
    gameTitles: data.gameTitles ?? {}, endsAt: data.endsAt?.toMillis() };
}

export function createExhibitionReader(db: Firestore, exhibitionId: string) {
  const access = doc(db, 'exhibitionAccess', exhibitionId);
  const appearance = doc(db, 'exhibitionPinAppearance', exhibitionId);

  async function generation(): Promise<Publication> {
    try {
      const available = publication((await getDocFromServer(access)).data());
      if (available) return available;
    } catch (error) {
      if ((error as { code?: string }).code !== 'permission-denied') throw error;
    }
    throw new ExhibitionUnavailable('현재 볼 수 있는 기록이 없습니다.');
  }

  async function readActive<T>(kind: 'names' | 'profiles', id: string) {
    const first = await generation();
    try {
      const snapshot = await getDocFromServer(doc(access, 'generations', first.id, kind, id));
      return { ...first, record: (snapshot.data() as T | undefined) ?? null, generationId: first.id };
    } catch (error) {
      if ((error as { code?: string }).code !== 'permission-denied') throw error;
      const next = await generation();
      if (first.id === next.id) throw error;
      const snapshot = await getDocFromServer(doc(access, 'generations', next.id, kind, id));
      return { ...next, record: (snapshot.data() as T | undefined) ?? null, generationId: next.id };
    }
  }

  async function findExhibitionMembers(name: string) {
    const id = await exhibitionNameKey(name);
    if (!id) return [];
    const result = await readActive<{ candidates: { profileId: string; yearLabel?: string }[] }>('names', id);
    return result.record?.candidates ?? [];
  }

  const loadExhibitionView = (id: string) => readActive<ExhibitionProfile>('profiles', id);
  const loadExhibitionProfile = async (id: string) => (await loadExhibitionView(id)).record;
  const loadExhibitionDescriptions = async () => {
    const snapshot = await getDocFromServer(appearance);
    return (snapshot.data()?.descriptions ?? (await generation()).descriptions) as Record<string, string>;
  };
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
    findExhibitionMembers, loadExhibitionProfile, loadExhibitionView, loadExhibitionDescriptions,
    watchExhibitionPublication, watchExhibitionCopy, watchExhibitionAppearance,
  };
}

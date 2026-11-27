import { doc, getDocFromServer, type Firestore } from 'firebase/firestore';
import { exhibitionNameKey, type ExhibitionProfile } from '../src/domain/exhibition/collection';

export class ExhibitionUnavailable extends Error {}

export function createExhibitionReader(db: Firestore, exhibitionId: string) {
  const access = doc(db, 'exhibitionAccess', exhibitionId);

  async function generation(): Promise<{ id: string; descriptions: Record<string, string> }> {
    try {
      const snapshot = await getDocFromServer(access);
      const data = snapshot.data();
      if (data?.enabled === true && typeof data.generationId === 'string' && data.generationId) {
        return { id: data.generationId, descriptions: data.descriptions ?? {} };
      }
    } catch (error) {
      if ((error as { code?: string }).code !== 'permission-denied') throw error;
    }
    throw new ExhibitionUnavailable('현재 볼 수 있는 기록이 없습니다.');
  }

  async function readActive<T>(kind: 'names' | 'profiles', id: string) {
    const first = await generation();
    try {
      const snapshot = await getDocFromServer(doc(access, 'generations', first.id, kind, id));
      return { record: (snapshot.data() as T | undefined) ?? null, descriptions: first.descriptions };
    } catch (error) {
      if ((error as { code?: string }).code !== 'permission-denied') throw error;
      const next = await generation();
      if (first.id === next.id) throw error;
      const snapshot = await getDocFromServer(doc(access, 'generations', next.id, kind, id));
      return { record: (snapshot.data() as T | undefined) ?? null, descriptions: next.descriptions };
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
  const loadExhibitionDescriptions = async () => (await generation()).descriptions;
  return { findExhibitionMembers, loadExhibitionProfile, loadExhibitionView, loadExhibitionDescriptions };
}

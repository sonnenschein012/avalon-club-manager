import { afterEach, expect, it, vi } from 'vitest';
import { createExhibitionReader } from '../../exhibition/reader';
import type { Firestore } from 'firebase/firestore';

const firestore = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  Bytes: class {},
  doc: (base: { path?: string }, ...parts: string[]) => ({ path: [base.path, ...parts].filter(Boolean).join('/') }),
  getDocFromServer: firestore.get,
  onSnapshot: vi.fn(),
}));

afterEach(() => { vi.useRealTimers(); firestore.get.mockReset(); });

it('reuses the publication read started while typing', async () => {
  const reader = createExhibitionReader({} as Firestore, 'avalon');
  const profileId = 'a'.repeat(64);
  firestore.get.mockImplementation(async ({ path }: { path: string }) => ({
    data: () => path === 'exhibitionAccess/avalon' ? { enabled: true, generationId: '42' }
      : path.includes('/names/') ? { candidates: [{ profileId }] } : { name: '합성 부원', days: [] },
  }));
  reader.primeExhibitionNameLookup();
  reader.primeExhibitionNameLookup();
  expect(await reader.findExhibitionMembers('합성 부원')).toEqual([{ profileId }]);
  expect((await reader.loadExhibitionView(profileId)).record?.name).toBe('합성 부원');
  expect(firestore.get).toHaveBeenCalledTimes(3);
  expect(firestore.get.mock.calls.filter(([ref]) => ref.path === 'exhibitionAccess/avalon')).toHaveLength(1);
});

it('ends a stalled name request at three seconds and a collection read at its remaining deadline', async () => {
  vi.useFakeTimers();
  const reader = createExhibitionReader({} as Firestore, 'avalon');
  firestore.get.mockImplementation(() => new Promise(() => {}));
  reader.primeExhibitionNameLookup();
  const name = expect(reader.findExhibitionMembers('합성 부원')).rejects.toMatchObject({ code: 'deadline-exceeded' });
  const profile = expect(reader.loadExhibitionView('a'.repeat(64), undefined, 1_200))
    .rejects.toMatchObject({ code: 'deadline-exceeded' });
  await vi.advanceTimersByTimeAsync(1_200);
  await profile;
  await vi.advanceTimersByTimeAsync(1_800);
  await name;
});

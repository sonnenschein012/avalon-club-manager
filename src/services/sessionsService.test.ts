import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocs } from 'firebase/firestore';
import { deleteSessionRecord, importSessionRecords, updateSessionGroupGames, updateSessionRecord } from './sessionsService';

const batch = vi.hoisted(() => ({
  set: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  commit: vi.fn().mockResolvedValue(undefined),
}));
const addAuditEventToBatch = vi.hoisted(() => vi.fn());
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../lib/chunkBatch', () => ({ commitBatchesInChunks: vi.fn() }));
vi.mock('./auditService', () => ({
  addAuditEventToBatch, addAuditEventToTransaction: addAuditEventToBatch,
  createAuditEventOperation: vi.fn(() => ({ type: 'set', ref: 'audit', data: {} })),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), increment: () => 'increment', writeBatch: vi.fn(() => batch),
  getDocs: vi.fn(), query: vi.fn(), where: vi.fn(), deleteField: () => 'delete-field',
  runTransaction: async (_db: unknown, action: (tx: unknown) => Promise<void>) => { await action(batch); await batch.commit(); },
  Timestamp: { fromDate: (date: Date) => date },
}));

describe('session persistence boundaries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('detaches every linked planning without changing its contents in the session deletion transaction', async () => {
    vi.mocked(getDocs).mockResolvedValue({ docs: [{ ref: 'planning-a' }, { ref: 'planning-b' }], size: 2 } as never);
    batch.get.mockResolvedValueOnce({ exists: () => true });
    for (const ref of ['planning-a', 'planning-b']) {
      batch.get.mockResolvedValueOnce({ ref, data: () => ({ sessionId: 'session' }) });
    }
    await deleteSessionRecord('session', '모임');
    expect(batch.update.mock.calls).toEqual([
      ['planning-a', { sessionId: 'delete-field' }], ['planning-b', { sessionId: 'delete-field' }],
    ]);
    expect(batch.delete).toHaveBeenCalledOnce();
    expect(addAuditEventToBatch).toHaveBeenCalledWith(batch, expect.objectContaining({ action: 'session.deleted' }));
    expect(batch.commit).toHaveBeenCalledOnce();
  });

  it('does not delete on lookup failure and reports failed atomic commits', async () => {
    vi.mocked(getDocs).mockRejectedValueOnce(new Error('lookup failed'));
    await expect(deleteSessionRecord('session')).rejects.toThrow('lookup failed');
    expect(batch.delete).not.toHaveBeenCalled();
    vi.mocked(getDocs).mockResolvedValueOnce({ docs: [], size: 0 } as never);
    batch.get.mockResolvedValueOnce({ exists: () => true });
    batch.commit.mockRejectedValueOnce(new Error('commit failed'));
    await expect(deleteSessionRecord('session')).rejects.toThrow('commit failed');
  });

  it('releases deletion after a read deadline and does not commit when the late read completes', async () => {
    vi.useFakeTimers();
    try {
      let complete!: (value: Awaited<ReturnType<typeof getDocs>>) => void;
      vi.mocked(getDocs).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
      const deleted = expect(deleteSessionRecord('session')).rejects.toMatchObject({ code: 'deadline-exceeded' });
      await vi.advanceTimersByTimeAsync(20_000);
      await deleted;
      complete({ size: 0, docs: [] } as never);
      await vi.runAllTimersAsync();
      expect(batch.commit).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('times out an unresponsive game read without writing after it resolves', async () => {
    vi.useFakeTimers();
    try {
      let complete!: (value: unknown) => void;
      batch.get.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
      const saved = expect(updateSessionGroupGames('session', 'group', ['game'])).rejects
        .toMatchObject({ code: 'deadline-exceeded' });
      await vi.advanceTimersByTimeAsync(20_000);
      await saved;
      complete({ exists: () => true, data: () => ({ groups: [{ id: 'group', gameIds: [] }] }) });
      await vi.runAllTimersAsync();
      expect(batch.update).not.toHaveBeenCalled();
      expect(batch.commit).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('retains absent versus explicit empty imported role snapshots', async () => {
    batch.get.mockResolvedValue({ exists: () => false });
    await importSessionRecords([
      { name: 'legacy', date: '2026-09-02', groups: [] },
      { name: 'current', date: '2026-09-02', groups: [], boardMemberIds: [] },
    ]);
    expect(batch.set.mock.calls[0]?.[1]).not.toHaveProperty('boardMemberIds');
    expect(batch.set.mock.calls[1]?.[1]).toHaveProperty('boardMemberIds', []);
  });

  it('keeps the stored board snapshot and untouched group edits when saving a session', async () => {
    const initial = { id: 'group', memberIds: ['member'], gameIds: [] };
    const remote = { ...initial, gameIds: ['recorded-game'] };
    batch.get.mockResolvedValue({
      exists: () => true, data: () => ({ groups: [remote], boardMemberIds: ['past-board-member'] }),
    } as never);

    await updateSessionRecord('session', { name: 'Renamed', date: '2026-09-02', groups: [initial] }, [initial]);

    expect(batch.update).toHaveBeenCalledWith(undefined, expect.objectContaining({
      name: 'Renamed', groups: [remote], boardMemberIds: ['past-board-member'],
    }));
    expect(addAuditEventToBatch).toHaveBeenCalledWith(batch, expect.objectContaining({ action: 'session.updated' }));
  });

  it('changes only games on the requested group and rejects a missing group', async () => {
    const selected = { id: 'selected', name: 'Current name', memberIds: ['member'], gameIds: ['old'] };
    const other = { id: 'other', memberIds: [], gameIds: ['keep'] };
    batch.get.mockResolvedValue({ exists: () => true, data: () => ({ groups: [selected, other] }) } as never);

    await updateSessionGroupGames('session', 'selected', ['new']);
    expect(batch.update).toHaveBeenCalledWith(undefined, { groups: [{ ...selected, gameIds: ['new'] }, other] });

    await expect(updateSessionGroupGames('session', 'missing', [])).rejects.toThrow('해당 조를 찾을 수 없습니다.');
    expect(batch.update).toHaveBeenCalledTimes(1);
  });
});

it('preserves anonymous guests on game-only edits and includes guest changes in audit summaries', async () => {
  vi.clearAllMocks();
  const initial = { id: 'group', memberIds: ['member'], guestCount: 2, gameIds: [] };
  batch.get.mockResolvedValue({ exists: () => true, data: () => ({ name: '세션', groups: [initial] }) } as never);
  await updateSessionGroupGames('session', 'group', ['new-game']);
  expect(batch.update).toHaveBeenCalledWith(undefined, { groups: [{ ...initial, gameIds: ['new-game'] }] });
  vi.clearAllMocks();
  await updateSessionRecord('session', { name: '세션', date: '2026-10-01', groups: [{ ...initial, guestCount: 3 }] }, [initial]);
  expect(batch.update).toHaveBeenCalledWith(undefined, expect.objectContaining({ groups: [expect.objectContaining({ guestCount: 3, memberIds: ['member'] })] }));
  expect(addAuditEventToBatch).toHaveBeenCalledWith(batch, expect.objectContaining({ changes: expect.arrayContaining([expect.objectContaining({ field: 'groups', before: expect.stringContaining('게스트 2명'), after: expect.stringContaining('게스트 3명') })]) }));
});

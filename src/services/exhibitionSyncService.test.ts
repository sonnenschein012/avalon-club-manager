import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchExhibitionSync } from './exhibitionSyncService';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  onSnapshot: () => () => {},
  getDocFromServer: mocks.read,
}));

describe('exhibition publication retry', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('pauses after quota exhaustion even when manually requested or reconnected', async () => {
    vi.useFakeTimers();
    mocks.read.mockRejectedValue(Object.assign(new Error('Quota exhausted'), { code: 'resource-exhausted' }));
    const status = vi.fn();
    const { stop, request } = watchExhibitionSync(status, vi.fn(), 'requests');
    try {
      await vi.advanceTimersByTimeAsync(500);
      expect(status).toHaveBeenLastCalledWith('quota');
      expect(mocks.read).toHaveBeenCalledTimes(1);
      request();
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(29 * 60_000);
      expect(mocks.read).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.read).toHaveBeenCalledTimes(2);
    } finally { stop(); }
  });
});

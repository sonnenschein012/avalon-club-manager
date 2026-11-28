import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchExhibitionSync } from './exhibitionSyncService';

type SettingsSnapshot = {
  data: () => { enabled: boolean; autoPublish?: boolean };
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
};

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  listen: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  collection: (_db: unknown, path: string) => path,
  onSnapshot: mocks.listen,
  getDocFromServer: mocks.read,
}));

function sendSettings(autoPublish?: boolean, fromCache = false) {
  const callback = mocks.listen.mock.calls.find(([path]) => path === 'exhibitionSettings/avalon')?.[2] as
    (snapshot: SettingsSnapshot) => void;
  callback({
    data: () => autoPublish === undefined ? { enabled: true } : { enabled: true, autoPublish },
    metadata: { fromCache, hasPendingWrites: false },
  });
}

describe('exhibition publication retry', () => {
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('starts scans only for a manual request or a server-confirmed opt-in and stops on opt-out', async () => {
    vi.useFakeTimers();
    mocks.listen.mockReturnValue(mocks.unsubscribe);
    mocks.read.mockRejectedValue(new Error('Offline'));
    const { stop, request } = watchExhibitionSync(vi.fn(), vi.fn(), 'sources');
    try {
      sendSettings();
      sendSettings(true, true);
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mocks.read).not.toHaveBeenCalled();
      expect(mocks.listen).toHaveBeenCalledTimes(1);
      request();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mocks.read).toHaveBeenCalledTimes(1);
      sendSettings(true);
      expect(mocks.listen.mock.calls.slice(1).map(([path]) => path)).toEqual(['sessions', 'members', 'games']);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(mocks.read).toHaveBeenCalledTimes(2);
      sendSettings(false);
      expect(mocks.unsubscribe).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mocks.read).toHaveBeenCalledTimes(2);
    } finally { stop(); }
  });

  it('pauses after quota exhaustion even when manually requested or reconnected', async () => {
    vi.useFakeTimers();
    mocks.listen.mockReturnValue(mocks.unsubscribe);
    mocks.read.mockRejectedValue(Object.assign(new Error('Quota exhausted'), { code: 'resource-exhausted' }));
    const status = vi.fn();
    const { stop, request } = watchExhibitionSync(status, vi.fn(), 'requests');
    try {
      sendSettings(true);
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

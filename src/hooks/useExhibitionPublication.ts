import { useEffect, useState } from 'react';
import { loadExhibitionStatus, retryExhibitionRefresh, type ExhibitionSyncStatus } from '../services/exhibitionSyncService';

const exhibitionId = import.meta.env.VITE_EXHIBITION_ID || 'avalon';

export function useExhibitionPublication(phase: ExhibitionSyncStatus, request: () => void) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof loadExhibitionStatus>>>();
  const [statusError, setStatusError] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    let active = true;
    void loadExhibitionStatus(exhibitionId).then(result => {
      if (active) { setStatus(result); setStatusError(false); setNow(Date.now()); }
    }).catch(() => {
      if (active) setStatusError(true);
    });
    return () => { active = false; };
  }, [phase, requesting]);

  useEffect(() => {
    const changedAt = [status?.startsAt, status?.endsAt].find(value => value && +value > now);
    if (!changedAt) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(+changedAt - now, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [now, status]);

  async function publish() {
    setRequesting(true);
    setRequestError(false);
    try {
      await retryExhibitionRefresh();
      request();
    } catch {
      setRequestError(true);
    } finally {
      setRequesting(false);
    }
  }

  return { status, statusError, requestError, requesting, publish, now };
}

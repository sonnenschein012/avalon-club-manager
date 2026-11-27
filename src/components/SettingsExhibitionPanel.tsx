import { ArrowUpRight, RefreshCw } from 'lucide-react';
import type { ExhibitionSyncError, ExhibitionSyncStatus } from '../services/exhibitionSyncService';
import { useExhibitionPublication } from '../hooks/useExhibitionPublication';

export interface ExhibitionPanelProps {
  phase: ExhibitionSyncStatus;
  failure: ExhibitionSyncError | null;
  request: () => void;
}

const stamp = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });

export default function SettingsExhibitionPanel({ phase, failure, request }: ExhibitionPanelProps) {
  const { status, statusError, requestError, requesting, publish, now } = useExhibitionPublication(phase, request);
  const publication = status?.published
    ? status.startsAt && +status.startsAt > now ? '공개 예정' : status.endsAt && +status.endsAt <= now ? '공개 종료' : '공개 중'
    : '공개된 기록 없음';
  const working = requesting || phase === 'syncing';
  const label = working ? '공개 기록 반영 중' : phase === 'error' ? '공개 기록 반영 실패'
    : phase === 'pending' || status?.pending ? '공개 기록 반영 대기'
    : statusError ? '반영 상태를 확인하지 못했습니다' : !status ? '반영 상태 확인 중'
    : status.published ? '공개 기록 반영 완료' : '공개된 기록 없음';

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm" aria-labelledby="exhibition-settings-heading">
      <h2 id="exhibition-settings-heading" className="text-lg font-bold text-slate-800">공개 전시</h2>
      <div className="mt-2 space-y-1 text-sm text-slate-600" role="status">
        <p className="font-semibold text-navy">{label}{status?.published && <span className="ml-2 text-slate-500">· {publication}</span>}</p>
        {status?.lastSyncedAt && <p>마지막 반영 {stamp.format(status.lastSyncedAt)} · 컬렉션 {status.profileCount ?? 0}개</p>}
        {failure && phase === 'error' && <p>{failure.step} ({failure.code})</p>}
      </div>
      {requestError && <p className="mt-2 text-sm text-red-700" role="alert">반영을 요청하지 못했습니다. 다시 시도해 주세요.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={working} onClick={() => void publish()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-gold disabled:opacity-50">
          <RefreshCw size={16} className={working ? 'motion-safe:animate-spin' : undefined} aria-hidden="true" /> 공개 기록 반영
        </button>
        <a href="https://avalon-collection-studio.web.app/" target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-navy transition-colors hover:bg-slate-50">
          아발론 Studio 열기 <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

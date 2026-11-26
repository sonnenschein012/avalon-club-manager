import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, getDocsFromServer } from 'firebase/firestore';
import { auth, checkAdminStatus, db, logout, signInWithGoogle } from '../src/lib/firebase';
import {
  loadExhibitionSettings, loadExhibitionStatus, retryExhibitionRefresh, saveExhibitionSettings,
  watchExhibitionSync, type ExhibitionSettings, type ExhibitionSyncStatus, type ExhibitionSyncError,
} from '../src/services/exhibitionSyncService';
import pins from '../exhibition/games.json';
import './style.css';

const catalog = Object.entries(pins);
const defaultId = import.meta.env.VITE_EXHIBITION_ID || 'avalon';
const empty: ExhibitionSettings = { enabled: false, period: { kind: 'all' }, gameMapping: [] };

type GameChoice = { id: string; title: string };

function ExhibitionForm({ id, games, initial, sync }: {
  id: string; games: GameChoice[]; initial: ExhibitionSettings; sync: ExhibitionSyncStatus;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [kind, setKind] = useState(initial.period.kind);
  const [mapping, setMapping] = useState(new Map(initial.gameMapping.map(item => [item.sourceId, item.pinId])));
  const [descriptions, setDescriptions] = useState(initial.descriptions ?? {});
  const [pin, setPin] = useState<keyof typeof pins>('avalon');
  const [status, setStatus] = useState<Awaited<ReturnType<typeof loadExhibitionStatus>>>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadExhibitionStatus(id).then(result => {
      if (!cancelled) setStatus(result);
    }).catch(() => { if (!cancelled) setStatus(undefined); });
    return () => { cancelled = true; };
  }, [id, sync]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const start = String(form.get('start') ?? '');
    const end = String(form.get('end') ?? '');
    if (kind === 'range' && start > end) {
      setMessage('시작일은 종료일보다 늦을 수 없습니다.');
      return;
    }
    const period = kind === 'semester' ? { kind, semester: String(form.get('semester')) }
      : kind === 'range' ? { kind, start, end } : { kind };
    setBusy(true);
    try {
      await saveExhibitionSettings(id, {
        enabled, period, gameMapping: [...mapping].map(([sourceId, pinId]) => ({ sourceId, pinId })),
        descriptions: Object.fromEntries(Object.entries(descriptions).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])),
      });
      setMessage(enabled ? '설정을 저장했습니다. 전시에 자동 반영됩니다.' : '설정을 저장하고 전시를 비공개로 전환했습니다.');
    } catch (error) {
      setMessage(`설정을 저장하지 못했습니다. (${(error as { code?: string }).code ?? 'unexpected-error'})`);
    } finally { setBusy(false); }
  }

  async function retry() {
    setBusy(true);
    try {
      await retryExhibitionRefresh();
      setMessage('저장된 설정으로 다시 반영을 요청했습니다.');
    } catch (error) {
      setMessage(`다시 반영을 요청하지 못했습니다. (${(error as { code?: string }).code ?? 'unexpected-error'})`);
    } finally { setBusy(false); }
  }

  const unmapped = new Set(status?.unmappedGameIds ?? []);
  const titles = new Map(games.map(game => [game.id, game.title]));
  const statusText = sync === 'error' ? '반영 실패 · 자동 재시도 예정' : sync === 'syncing' ? '반영 중' : sync === 'pending' || status?.pending ? '반영 대기'
    : status ? '대기 작업 없음' : '상태 확인 중';

  return <>
    <section className="status" aria-label="반영 상태">
      <div>
        <strong role="status">{statusText}</strong>
        <p>미연결 게임 {unmapped.size}개 · 누락 회원 참조 {status?.missingMemberIds.length ?? 0}개</p>
      </div>
      <button type="button" disabled={busy} onClick={() => void retry()}>다시 반영</button>
    </section>
    {unmapped.size > 0 && <details><summary>미연결 게임 확인</summary><ul>
      {[...unmapped].map(game => <li key={game}>{titles.get(game) ?? game}</li>)}
    </ul></details>}
    <form onSubmit={event => void save(event)}>
      <fieldset disabled={busy}>
        <legend>기간과 공개 상태</legend>
        <label className="check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> 부원에게 전시 공개</label>
        <label>기록 범위<select value={kind} onChange={event => setKind(event.target.value as ExhibitionSettings['period']['kind'])}>
          <option value="all">전체 기록</option><option value="semester">학기</option><option value="range">날짜 범위</option>
        </select></label>
        {kind === 'semester' && <label>학기<input name="semester" placeholder="2026-2" pattern="[0-9]{4}-[12]" required defaultValue={initial.period.kind === 'semester' ? initial.period.semester : ''} /></label>}
        {kind === 'range' && <div className="row">
          <label>시작일<input type="date" name="start" required defaultValue={initial.period.kind === 'range' ? initial.period.start : ''} /></label>
          <label>종료일<input type="date" name="end" required defaultValue={initial.period.kind === 'range' ? initial.period.end : ''} /></label>
        </div>}
      </fieldset>
      <fieldset disabled={busy}>
        <legend>운영 게임과 전시 핀 연결</legend>
        {games.length === 0 && <p>운영 앱에 등록된 게임이 없습니다.</p>}
        {games.map(game => <label className="mapping" key={game.id}>{game.title}
          <select aria-label={`${game.title} 전시 핀`} value={mapping.get(game.id) ?? ''} onChange={event => {
            const chosen = event.target.value;
            setMapping(previous => {
              const next = new Map(previous);
              if (chosen) next.set(game.id, chosen);
              else next.delete(game.id);
              return next;
            });
          }}>
            <option value="">미연결</option>
            {catalog.map(([pinId, item]) => <option key={pinId} value={pinId}>{item.ko}</option>)}
          </select>
        </label>)}
      </fieldset>
      <fieldset disabled={busy}>
        <legend>핀 설명</legend>
        <label>전시 핀<select value={pin} onChange={event => setPin(event.target.value as keyof typeof pins)}>
          {catalog.map(([pinId, item]) => <option key={pinId} value={pinId}>{item.ko}</option>)}
        </select></label>
        <label>설명<textarea rows={4} maxLength={500} placeholder={pins[pin].motif} value={descriptions[pin] ?? ''}
          onChange={event => setDescriptions({ ...descriptions, [pin]: event.target.value })} /></label>
        <p>설명을 비워 두면 기존 설명이 표시됩니다.</p>
      </fieldset>
      <div className="actions"><button type="submit" className="primary" disabled={busy}>설정 저장</button><span role="status">{message}</span></div>
    </form>
  </>;
}

function Workspace({ user }: { user: User }) {
  const [id, setId] = useState(defaultId);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ settings: ExhibitionSettings; games: GameChoice[] }>();
  const [sync, setSync] = useState<ExhibitionSyncStatus>('idle');
  const [syncError, setSyncError] = useState<ExhibitionSyncError | null>(null);
  const [error, setError] = useState('');

  useEffect(() => watchExhibitionSync(setSync, setSyncError), []);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadExhibitionSettings(id), getDocsFromServer(collection(db, 'games'))]).then(([settings, games]) => {
      const choices = games.docs.map(item => ({ id: item.id, title: String(item.data().title ?? item.id) }));
      choices.sort((a, b) => a.title.localeCompare(b.title, 'ko'));
      if (!cancelled) setLoaded({ settings: settings ?? empty, games: choices });
    }).catch(() => { if (!cancelled) setError('전시 설정을 불러오지 못했습니다. 관리자 권한과 연결을 확인해 주세요.'); });
    return () => { cancelled = true; };
  }, [id, loadAttempt]);

  return <>
    <div className="account"><span>{user.email}</span><button type="button" onClick={() => void logout()}>로그아웃</button></div>
    <form className="identifier" onSubmit={event => {
      event.preventDefault();
      const selected = String(new FormData(event.currentTarget).get('exhibitionId')).trim();
      if (selected === id && loaded) return;
      setError('');
      setLoaded(undefined);
      setId(selected);
      setLoadAttempt(attempt => attempt + 1);
    }}>
      <label>전시 ID<input name="exhibitionId" defaultValue={id} required maxLength={60} pattern="[a-zA-Z0-9_\-]+" /></label>
      <button type="submit">열기</button>
    </form>
    {syncError && <p role="alert">
      전시 동기화 오류 · {syncError.step} ({syncError.code})
    </p>}
    {error ? <p role="alert">{error}</p> : loaded
      ? <ExhibitionForm key={id} id={id} initial={loaded.settings} games={loaded.games} sync={sync} />
      : <p role="status">전시 설정을 불러오는 중입니다.</p>}
  </>;
}

function App() {
  const [session, setSession] = useState<{ user: User | null; allowed: boolean }>();
  const [message, setMessage] = useState('');
  useEffect(() => {
    let epoch = 0;
    const unsubscribe = onAuthStateChanged(auth, async user => {
      const request = ++epoch;
      if (!user?.email) { setSession({ user, allowed: false }); return; }
      setSession(undefined);
      const result = await checkAdminStatus(user.email);
      if (request === epoch) setSession({ user, allowed: result.isAdmin });
    });
    return () => { epoch++; unsubscribe(); };
  }, []);

  return <main>
    <h1>아발론 전시 관리</h1>
    {!session ? <p role="status">관리자 권한을 확인하는 중입니다.</p>
      : session.user && session.allowed ? <Workspace key={session.user.uid} user={session.user} />
        : session.user ? <><p role="alert">기존 운영 앱의 관리자 권한이 필요합니다.</p>
          <button type="button" onClick={() => void logout()}>로그아웃</button></>
          : <><button type="button" className="primary" onClick={() => {
            setMessage('');
            void signInWithGoogle().catch(() => setMessage('로그인하지 못했습니다. 다시 시도해 주세요.'));
          }}>Google 관리자 로그인</button><p role="status">{message}</p></>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);

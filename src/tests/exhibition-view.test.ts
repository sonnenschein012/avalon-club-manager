import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const profileId = 'a'.repeat(64);
const companionId = 'b'.repeat(64);
const otherId = 'c'.repeat(64);
const api = vi.hoisted(() => ({
  find: vi.fn(), load: vi.fn(), generation: '1',
  prime: vi.fn(),
  viewBudget: vi.fn(),
  loadImage: vi.fn(),
  appearance: undefined as ((notice: { descriptions: Record<string, string>; images: Record<string, string> }) => void) | undefined,
  publication: undefined as ((notice: { id: string; descriptions: Record<string, string> }) => void) | undefined,
  copy: undefined as ((notice: Record<string, string>) => void) | undefined,
}));
vi.mock('../../exhibition/data', () => ({
  exhibitionLookupBudget: 3_000,
  primeExhibitionNameLookup: api.prime,
  findExhibitionMembers: api.find,
  loadExhibitionView: async (id: string, _publication: unknown, budget: number | undefined) => {
    api.viewBudget(budget);
    return { record: await api.load(id), generationId: api.generation, descriptions: { avalon: '전시 설명' } };
  },
  loadExhibitionPinImage: api.loadImage,
  watchExhibitionPublication: (callback: typeof api.publication) => { api.publication = callback; return () => {}; },
  watchExhibitionCopy: (callback: typeof api.copy) => { api.copy = callback; return () => {}; },
  watchExhibitionAppearance: (callback: typeof api.appearance) => {
    api.appearance = callback;
    return () => { api.appearance = undefined; };
  },
  exhibitionErrorMessage: (_error: unknown, copy: { loadError: string }) => copy.loadError,
}));

const click = (selector: string) => document.querySelector<HTMLElement>(selector)?.click();
const pins = () => [...document.querySelectorAll<HTMLElement>('.works [data-pin]')]
  .sort((a, b) => parseFloat(b.style.getPropertyValue('--size')) - parseFloat(a.style.getPropertyValue('--size')))
  .map(pin => pin.dataset.pin);
const submitName = (value: string) => {
  document.querySelector<HTMLInputElement>('#member-name')!.value = value;
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
};

describe('public exhibition view', () => {
  beforeAll(async () => {
    const html = new DOMParser().parseFromString(readFileSync('exhibition/index.html', 'utf8'), 'text/html');
    document.body.innerHTML = html.body.innerHTML;
    window.scrollTo = vi.fn();
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    await import('../../exhibition/main.js');
  });

  afterEach(() => {
    history.replaceState(null, '', '#');
    window.dispatchEvent(new Event('hashchange'));
    vi.resetAllMocks();
    api.generation = '1';
    api.copy?.({});
  });

  it('opens a name match, filters same-group games and returns focus from a pin', async () => {
    api.find.mockResolvedValue([{ profileId }]);
    api.load.mockResolvedValue({ name: '합성 가람', days: [
      { date: '2026-09-02', gameIds: ['avalon', 'dixit'], gameCounts: { avalon: 2, dixit: 1 },
        companions: [{ profileId: companionId, name: '합성 한결', gameIds: ['avalon'] },
          { profileId: otherId, name: '합성 다온', gameIds: ['dixit'] }] },
      { date: '2026-09-01', gameIds: ['coffee'], gameCounts: { coffee: 3 },
        companions: [{ profileId: companionId, name: '합성 한결', gameIds: ['coffee'] }] },
    ] });
    submitName('합성 가람');
    await vi.waitFor(() => expect(pins()).toEqual(['coffee', 'avalon', 'dixit']));

    const archiveOrder = () => [...document.querySelectorAll('.session-archive > *')]
      .map(element => element.classList[0]);
    expect(archiveOrder()).toEqual(['archive-heading', 'archive-dates', 'archive-people']);

    click('.archive-date[href*="2026-09-02"]');
    expect(pins()).toEqual(['avalon', 'dixit']);
    expect(archiveOrder()).toEqual(['archive-people', 'archive-heading', 'archive-dates']);
    expect(document.querySelector('.archive-people-label')?.textContent).toBe('같은 조에 있었던 사람');
    click(`.archive-people a[href$="/${companionId}"]`);
    expect(pins()).toEqual(['coffee', 'avalon']);
    expect(document.querySelector('.companion-filter')?.textContent).toContain('합성 한결');
    click('.archive-date[href*="2026-09-02"]');
    expect(pins()).toEqual(['avalon']);

    click('[data-pin="avalon"]');
    expect(document.querySelector('dialog')?.open).toBe(true);
    expect(document.querySelector('#object-title')?.textContent).toBe('레지스탕스 아발론');
    expect(document.querySelector('.object-text')?.textContent).toBe('전시 설명');
    api.appearance?.({ descriptions: { avalon: '새 전시 설명' }, images: {} });
    expect(document.querySelector('.object-text')?.textContent).toBe('새 전시 설명');
    click('[data-close]');
    await vi.waitFor(() => expect(document.querySelector('dialog')?.open).toBe(false));
    expect(document.activeElement?.getAttribute('data-pin')).toBe('avalon');
    click('.companion-filter a');
    expect(pins()).toEqual(['avalon', 'dixit']);
    expect(api.load).toHaveBeenCalledTimes(1);
  });

  it('shows separate choices for same-name records and reports missing and unavailable lookups', async () => {
    api.find.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { profileId: companionId, yearLabel: '25' }, { profileId: otherId, yearLabel: '26' },
    ]).mockRejectedValueOnce(new Error('unavailable'));
    api.load.mockResolvedValue(null);
    submitName('없는 이름');
    await vi.waitFor(() => expect(document.querySelector('#entry-error')?.textContent).toContain('찾지 못했습니다'));
    submitName('합성 한결');
    await vi.waitFor(() => expect([...document.querySelectorAll('#name-matches button')].map(button => button.textContent))
      .toEqual(['25학번', '26학번']));
    click('#name-matches button:nth-child(2)');
    await vi.waitFor(() => expect(document.querySelector('#entry-error')?.textContent).toContain('찾지 못했습니다'));
    expect(api.load).toHaveBeenCalledWith(otherId);
    api.copy?.({ loadError: '전시 조회 실패' });
    submitName('다시 시도');
    await vi.waitFor(() => expect(document.querySelector('#entry-error')?.textContent).toBe('전시 조회 실패'));
    const retry = document.querySelector('.entry-retry');
    expect(retry?.getAttribute('aria-label')).toBe('다시 시도');
    expect(retry?.textContent).toBe('');
    expect(retry?.querySelector('use')?.getAttribute('href')).toBe('#retry');
    expect(document.querySelector<HTMLInputElement>('#member-name')?.value).toBe('다시 시도');
    api.find.mockResolvedValueOnce([]);
    click('.entry-retry');
    await vi.waitFor(() => expect(document.querySelector('#entry-error')?.textContent).toContain('찾지 못했습니다'));
  });

  it('keeps one skeleton from name submission through reading a single matching collection', async () => {
    let finishName!: (value: { profileId: string }[]) => void;
    let finishRecord!: (value: { name: string; days: [] }) => void;
    api.find.mockReturnValueOnce(new Promise(resolve => { finishName = resolve; }));
    api.load.mockReturnValueOnce(new Promise(resolve => { finishRecord = resolve; }));
    submitName('합성 부원');
    const frame = document.querySelector('.collection-skeleton');
    expect(frame).not.toBeNull();
    expect(document.querySelector('[data-loading-copy]')?.textContent).toBe('기록을 확인하는 중입니다.');
    expect(document.querySelector('#member-name')).toBeNull();
    finishName([{ profileId }]);
    await vi.waitFor(() => expect(document.querySelector('[data-loading-copy]')?.textContent).toBe('기록을 불러오는 중입니다.'));
    expect(document.querySelector('.collection-skeleton')).toBe(frame);
    const budget = api.viewBudget.mock.lastCall?.[0];
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThanOrEqual(3_000);
    finishRecord({ name: '합성 부원', days: [] });
    await vi.waitFor(() => expect(document.querySelector('.collection-skeleton')).toBeNull());
  });

  it('shows the name and date for a recorded game without a pin image', async () => {
    const unillustrated = 'game-' + 'f'.repeat(64);
    api.find.mockResolvedValue([{ profileId }]);
    api.load.mockResolvedValue({ name: '합성 부원', gameTitles: { [unillustrated]: '핀 없는 게임' },
      days: [{ date: '2026-09-02', gameIds: [unillustrated], companions: [] }] });
    submitName('합성 부원');
    await vi.waitFor(() => expect(pins()).toEqual([unillustrated]));
    click(`[data-pin="${unillustrated}"]`);
    const dialog = document.querySelector('dialog');
    expect(dialog?.querySelector('#object-title')?.textContent).toBe('핀 없는 게임');
    expect(dialog?.querySelector('time')?.dateTime).toBe('2026-09-02');
    expect(dialog?.querySelector('img')).toBeNull();
  });

  it('updates entry text without clearing the form and refreshes a published collection already on screen', async () => {
    const input = document.querySelector<HTMLInputElement>('#member-name')!;
    input.value = '합성 부원';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(api.prime).toHaveBeenCalledOnce();
    api.copy?.({ entryTitle: '우리가 한 게임', edition: '새 부제', namePrompt: '부원 이름을 적어 주세요' });
    expect(document.querySelector('.entry-title')?.textContent).toBe('우리가 한 게임');
    expect(document.querySelector('.entry-edition')?.textContent).toBe('새 부제');
    expect(input.placeholder).toBe('부원 이름을 적어 주세요');
    expect(input.value).toBe('합성 부원');

    api.find.mockResolvedValue([{ profileId }]);
    api.load.mockResolvedValue({ name: '합성 부원', days: [
      { date: '2026-09-02', gameIds: ['avalon'], companions: [] },
      { date: '2026-09-01', gameIds: ['coffee'], companions: [] },
    ] });
    submitName(input.value);
    await vi.waitFor(() => expect(pins()).toEqual(['avalon', 'coffee']));
    click('.archive-date[href*="2026-09-02"]');
    expect(pins()).toEqual(['avalon']);

    api.generation = '2';
    api.load.mockResolvedValue({ name: '합성 부원', days: [
      { date: '2026-09-02', gameIds: ['dixit'], companions: [] },
      { date: '2026-09-01', gameIds: ['coffee'], companions: [] },
    ] });
    api.publication?.({ id: '2', descriptions: {} });
    await vi.waitFor(() => expect(pins()).toEqual(['dixit']));
    expect(document.querySelector('.archive-date[aria-current] time')?.getAttribute('datetime')).toBe('2026-09-02');
  });
});

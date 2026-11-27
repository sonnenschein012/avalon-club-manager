import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const profileId = 'a'.repeat(64);
const companionId = 'b'.repeat(64);
const otherId = 'c'.repeat(64);
const api = vi.hoisted(() => ({
  find: vi.fn(), load: vi.fn(), descriptions: vi.fn(), generation: '1',
  publication: undefined as ((notice: { id: string; descriptions: Record<string, string> }) => void) | undefined,
  copy: undefined as ((notice: { entryTitle: string; edition: string; namePrompt: string }) => void) | undefined,
}));
vi.mock('../../exhibition/data', () => ({
  findExhibitionMembers: api.find,
  loadExhibitionView: async (id: string) => ({ record: await api.load(id), generationId: api.generation, descriptions: { avalon: '전시 설명' } }),
  loadExhibitionDescriptions: api.descriptions,
  watchExhibitionPublication: (callback: typeof api.publication) => { api.publication = callback; return () => {}; },
  watchExhibitionCopy: (callback: typeof api.copy) => { api.copy = callback; return () => {}; },
  watchExhibitionAppearance: () => () => {},
  exhibitionErrorMessage: () => '전시 조회 실패',
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

  beforeEach(() => { api.descriptions.mockResolvedValue({}); });

  afterEach(() => {
    history.replaceState(null, '', '#');
    window.dispatchEvent(new Event('hashchange'));
    vi.resetAllMocks();
    api.generation = '1';
  });

  it('opens a name match, filters same-group games and returns focus from a pin', async () => {
    api.find.mockResolvedValue([{ profileId }]);
    api.descriptions.mockResolvedValue({ avalon: '새 전시 설명' });
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
    await vi.waitFor(() => expect(document.querySelector('.object-text')?.textContent).toBe('새 전시 설명'));
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
    submitName('다시 시도');
    await vi.waitFor(() => expect(document.querySelector('#entry-error')?.textContent).toBe('전시 조회 실패'));
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

import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const profileId = 'a'.repeat(64);
const companionId = 'b'.repeat(64);
const otherId = 'c'.repeat(64);
const api = vi.hoisted(() => ({ find: vi.fn(), load: vi.fn() }));
vi.mock('../../exhibition/data', () => ({
  findExhibitionMembers: api.find,
  loadExhibitionView: async (id: string) => ({ record: await api.load(id), descriptions: { avalon: '전시 설명' } }),
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

  afterEach(() => {
    history.replaceState(null, '', '#');
    window.dispatchEvent(new Event('hashchange'));
    vi.resetAllMocks();
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

    click('.archive-date[href*="2026-09-02"]');
    expect(pins()).toEqual(['avalon', 'dixit']);
    click(`.archive-people a[href$="/${companionId}"]`);
    expect(pins()).toEqual(['coffee', 'avalon']);
    expect(document.querySelector('.companion-filter')?.textContent).toContain('합성 한결');
    click('.archive-date[href*="2026-09-02"]');
    expect(pins()).toEqual(['avalon']);

    click('[data-pin="avalon"]');
    expect(document.querySelector('dialog')?.open).toBe(true);
    expect(document.querySelector('#object-title')?.textContent).toBe('레지스탕스 아발론');
    expect(document.querySelector('.object-text')?.textContent).toBe('전시 설명');
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
});

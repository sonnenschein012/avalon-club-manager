import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exhibitionCopy, exhibitionPins } from '../domain/exhibition/presentation';

const mocks = vi.hoisted(() => ({
  authChanged: undefined as ((user: { uid: string; email: string }) => void) | undefined,
  admin: vi.fn(),
  save: vi.fn(),
  retry: vi.fn(),
  request: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: typeof mocks.authChanged) => {
    mocks.authChanged = callback;
    return () => {};
  },
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocsFromServer: async () => ({ docs: [
    { id: 'source-game', data: () => ({ title: '레지스탕스 아발론' }) },
    { id: 'labyrinth-game', data: () => ({ title: '라비린스' }) },
    { id: 'magic-labyrinth-game', data: () => ({ title: '마법의 미로' }) },
    { id: 'hanabi-game', data: () => ({ title: '하나비' }) },
  ] }),
}));
vi.mock('../lib/firebase', () => ({
  auth: {}, db: {}, checkAdminStatus: mocks.admin, logout: vi.fn(), signInWithGoogle: vi.fn(),
}));
vi.mock('../services/exhibitionSyncService', () => ({
  loadExhibitionSettings: async () => ({ enabled: false, period: { kind: 'all' }, gameMapping: [] }),
  loadExhibitionStatus: async () => ({ pending: false, unmappedGameIds: ['source-game'], missingMemberIds: [] }),
  retryExhibitionRefresh: mocks.retry,
  saveExhibitionSettings: mocks.save,
  watchExhibitionSync: () => ({ stop: () => {}, request: mocks.request }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { vi.unstubAllGlobals(); });

function clickButton(label: string) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  button.click();
}

function press(selector: string, key: string) {
  const target = document.querySelector<HTMLElement>(selector);
  if (!target) throw new Error(`Missing control: ${selector}`);
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function change(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
  if (!input) throw new Error(`Missing input: ${selector}`);
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

describe('exhibition admin settings', () => {
  it('checks the existing role and saves settings for automatic reflection', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    document.body.innerHTML = '<div id="root"></div>';
    mocks.admin.mockResolvedValueOnce({ isAdmin: false }).mockResolvedValueOnce({ isAdmin: true });
    mocks.save.mockResolvedValue(true);
    mocks.retry.mockResolvedValue(undefined);
    await act(async () => { await import('../../exhibition-admin/main'); });

    await act(async () => { mocks.authChanged?.({ uid: 'visitor', email: 'visitor@example.invalid' }); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Admin access is required');
    await act(async () => { mocks.authChanged?.({ uid: 'operator', email: 'operator@example.invalid' }); });
    expect(document.querySelector('h1')?.textContent).toBe('AVALON Studio');
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[role="radio"][value="temporary"]')!.click();
    });
    await act(async () => { change('input[placeholder="YYYY-MM-DD"]', '2026-11-25'); });
    await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="Choose close after"]')!.click(); });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('November 2026');
    const day = (number: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find(item => item.textContent === number);
    expect(day('24')).toHaveProperty('disabled', true);
    await act(async () => { day('27')!.click(); });
    await act(async () => { document.querySelector<HTMLButtonElement>('button[role="radio"][value="semesterRange"]')!.click(); });
    await act(async () => {
      change('input[aria-label="Start semester year"]', '2025');
      change('input[aria-label="End semester year"]', '2027');
    });
    for (const label of ['Start semester term', 'End semester term']) {
      await act(async () => { press(`[role="combobox"][aria-label="${label}"]`, 'Enter'); });
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === 'Semester 2');
      await act(async () => { option!.click(); });
    }
    await act(async () => { press('[role="tab"][id$="-trigger-pins"]', 'Enter'); });
    const searches = [['라비린스', 'Labyrinth'], ['Labyrinth', 'Labyrinth'], ['하나비', 'Hanabi'], ['Hanabi', 'Hanabi']] as const;
    for (const [query, title] of searches) {
      await act(async () => { change('input[type="search"]', query); });
      await act(async () => { clickButton(title); });
      expect(document.querySelector('h3')?.textContent).toBe(title);
    }
    await act(async () => { change('input[type="search"]', 'Avalon'); });
    await act(async () => { clickButton('The Resistance: Avalon'); });
    expect(document.querySelector('textarea')).toHaveProperty('value', exhibitionPins.avalon?.motif);
    await act(async () => {
      change('textarea', ' 새 핀 설명 ');
      change('input[inputmode="url"]', 'https://example.com/pin.webp');
    });
    expect(document.querySelector('img[alt="The Resistance: Avalon pin"]')?.getAttribute('src')).toBe('https://example.com/pin.webp');
    await act(async () => { press('[role="tab"][id$="-trigger-copy"]', 'Enter'); });
    expect(document.querySelector('input#entryTitle')).toHaveProperty('value', exhibitionCopy.entryTitle);
    expect(document.querySelector('input#namePrompt')).toHaveProperty('value', exhibitionCopy.namePrompt);
    await act(async () => { change('input#entryTitle', '우리의 컬렉션'); });
    await act(async () => { clickButton('Save changes'); });
    expect(mocks.save).toHaveBeenCalledWith('avalon', {
      enabled: true, visibility: 'temporary', schedule: { start: '2026-11-25', end: '2026-11-27' },
      period: { kind: 'range', start: '2025-09-01', end: '2028-02-29', semesters: { start: '2025-2', end: '2027-2' } },
      gameMapping: [],
      descriptions: { avalon: '새 핀 설명' },
      images: { avalon: 'https://example.com/pin.webp' },
      copy: { entryTitle: '우리의 컬렉션' },
    });
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Exhibit text');
    expect(window.location.hash).toBe('#copy');
    expect(document.body.textContent).toContain('Changes saved. Updating records');
    expect(mocks.request).toHaveBeenCalledOnce();
    await act(async () => { clickButton('Sync records'); });
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledTimes(2);
  }, 15_000);
});

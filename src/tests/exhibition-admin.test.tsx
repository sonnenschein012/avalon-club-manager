import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exhibitionCopy, exhibitionPins, fallbackExhibitionPin } from '../domain/exhibition/presentation';

const mocks = vi.hoisted(() => ({
  authChanged: undefined as ((user: { uid: string; email: string }) => void) | undefined,
  admin: vi.fn(),
  save: vi.fn(),
  retry: vi.fn(),
  request: vi.fn(),
  prepareImage: vi.fn(),
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
    { id: 'missing-pin', data: () => ({ title: '미등록 게임' }) },
    { id: 'unused-game', data: () => ({ title: '기록 없는 게임' }) },
  ] }),
}));
vi.mock('../lib/firebase', () => ({
  auth: {}, db: {}, checkAdminStatus: mocks.admin, logout: vi.fn(), signInWithGoogle: vi.fn(),
}));
vi.mock('../../exhibition-admin/pinImage', () => ({ preparePinImage: mocks.prepareImage }));
vi.mock('../../exhibition/reader', () => ({ readUploadedPinImage: async () => 'data:image/webp;base64,AAEC' }));
vi.mock('../services/exhibitionSyncService', () => ({
  loadExhibitionSettings: async () => ({ enabled: false, period: { kind: 'all' }, gameMapping: [] }),
  loadExhibitionStatus: async () => ({ pending: false, generationId: '42', unmappedGameIds: ['source-game'], missingMemberIds: [] }),
  loadPublishedExhibitionGameKeys: async () => [fallbackExhibitionPin('missing-pin'), fallbackExhibitionPin('source-game')],
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
    await act(async () => { press('[role="tab"][id$="-trigger-worklist"]', 'Enter'); });
    const worklist = document.querySelector('[role="tabpanel"][id$="-content-worklist"]')!;
    await act(async () => { clickButton('한국어'); });
    expect(document.documentElement.lang).toBe('ko');
    expect(localStorage.getItem('avalon-studio-language')).toBe('ko');
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('작업 현황');
    expect(worklist.textContent).toContain('이미지 미등록');
    await act(async () => { clickButton('English'); });
    expect(worklist.textContent).toContain('Missing image');
    expect(worklist.textContent).toContain('Missing description');
    expect(worklist.textContent).not.toContain('The Resistance: Avalon');
    expect(worklist.textContent).not.toContain('기록 없는 게임');
    await act(async () => { clickButton('All catalog games'); });
    expect(worklist.textContent).toContain('기록 없는 게임');
    await act(async () => { clickButton('In published records'); });
    const missingGame = () => [...worklist.querySelectorAll<HTMLButtonElement>('li button')]
      .find(button => button.textContent?.includes('미등록 게임'));
    expect(missingGame()?.textContent).toContain('Missing image');
    expect(missingGame()?.textContent).toContain('Missing description');
    await act(async () => missingGame()!.click());
    expect(document.querySelector('h3')?.textContent).toBe('미등록 게임');
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Games and pins');
    expect(document.querySelector('textarea')).toHaveProperty('value', '');
    expect(document.querySelector('input[type="file"]')).toHaveProperty('hidden', true);
    await act(async () => { press('[role="tab"][id$="-trigger-publication"]', 'Enter'); });
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
    const gameKey = fallbackExhibitionPin('source-game');
    expect(document.querySelector('textarea')).toHaveProperty('value', exhibitionPins.avalon?.motif);
    expect(document.querySelector('#pin-choice')).toBeNull();
    expect(document.body.textContent).toContain('Default image');
    expect(document.body.textContent).toContain('Replace image');
    const help = document.querySelector<HTMLButtonElement>('button[aria-label="Image requirements"]')!;
    const helpPanel = document.getElementById(help.getAttribute('aria-controls')!)!;
    expect(helpPanel.hidden).toBe(true);
    await act(async () => help.click());
    expect(help.getAttribute('aria-expanded')).toBe('true');
    expect(helpPanel.textContent).toContain('up to 16 MB');
    expect(helpPanel.textContent).toContain('512 px');
    await act(async () => help.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(helpPanel.hidden).toBe(true);
    expect(document.querySelector('details')).not.toHaveProperty('open', true);
    await act(async () => document.querySelector<HTMLElement>('summary')?.click());
    expect(document.querySelector('details')).toHaveProperty('open', true);
    expect(document.querySelector('label[for="pin-image"]')?.textContent).toBe('Image URL (optional)');
    await act(async () => {
      change('textarea', ' 새 핀 설명 ');
      change('input[inputmode="url"]', 'https://example.com/pin.webp');
    });
    await act(async () => { clickButton('한국어'); });
    expect(document.querySelector('h3')?.textContent).toBe('레지스탕스 아발론');
    expect(document.querySelector('textarea')).toHaveProperty('value', ' 새 핀 설명 ');
    expect(document.querySelector('label[for="pin-image"]')?.textContent).toBe('이미지 URL (선택)');
    expect(document.querySelector('input[inputmode="url"]')).toHaveProperty('value', 'https://example.com/pin.webp');
    await act(async () => { clickButton('English'); });
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
      descriptions: { [gameKey]: '새 핀 설명' },
      images: { [gameKey]: 'https://example.com/pin.webp' },
      copy: { entryTitle: '우리의 컬렉션' },
    });
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Exhibit text');
    expect(window.location.hash).toBe('#copy');
    expect(document.body.textContent).toContain('Changes saved. Updating records');
    expect(mocks.request).toHaveBeenCalledOnce();
    await act(async () => { clickButton('Publish records'); });
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    await act(async () => { press('[role="tab"][id$="-trigger-pins"]', 'Enter'); });
    const upload = {
      version: 'upload:00000000-0000-4000-8000-000000000001',
      bytes: new Uint8Array([0, 1, 2]),
      preview: 'data:image/webp;base64,AAEC',
    };
    mocks.prepareImage.mockResolvedValueOnce(upload);
    await act(async () => {
      const fileInput = document.querySelector<HTMLInputElement>('#pin-file')!;
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['image'], 'pin.png', { type: 'image/png' })] });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.querySelector('img[alt="The Resistance: Avalon pin"]')?.getAttribute('src')).toBe(upload.preview);
    await act(async () => { clickButton('Save changes'); });
    expect(mocks.save).toHaveBeenLastCalledWith('avalon', expect.objectContaining({ images: { [gameKey]: upload.version } }),
      new Map([[gameKey, upload]]));
    expect(document.body.textContent).toContain('Uploaded image');
    expect(document.body.textContent).not.toContain('New image ready to save');
    const replacement = { ...upload, version: 'upload:00000000-0000-4000-8000-000000000002' };
    mocks.prepareImage.mockResolvedValueOnce(replacement);
    await act(async () => {
      change('textarea', '저장하지 않을 핀 설명');
      const fileInput = document.querySelector<HTMLInputElement>('#pin-file')!;
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['replacement'], 'new.png', { type: 'image/png' })] });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.body.textContent).toContain('New image ready to save');
    const savesBeforeCancel = mocks.save.mock.calls.length;
    await act(async () => { clickButton('한국어'); });
    await act(async () => { clickButton('취소'); });
    expect(document.querySelector('h3')).toBeNull();
    expect(document.querySelector('#game-search')).toHaveProperty('value', '');
    expect(document.activeElement?.id).toBe('game-search');
    expect(document.querySelector('form button[type="submit"]')).toBeNull();
    expect(document.querySelector('form')?.textContent).not.toContain('취소');
    expect(document.body.textContent).not.toContain('마지막으로 저장한 설정으로 되돌렸습니다.');
    expect(mocks.save).toHaveBeenCalledTimes(savesBeforeCancel);
    await act(async () => { change('input[type="search"]', 'Avalon'); });
    expect(document.querySelector('form button[type="submit"]')).toBeNull();
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(mocks.save).toHaveBeenCalledTimes(savesBeforeCancel);
    await act(async () => { clickButton('레지스탕스 아발론'); });
    expect(document.querySelector('form button[type="submit"]')).not.toBeNull();
    expect(document.querySelector('h3')?.textContent).toBe('레지스탕스 아발론');
    expect(document.querySelector('textarea')).toHaveProperty('value', '새 핀 설명');
    expect(document.body.textContent).toContain('등록된 이미지');
    expect(document.body.textContent).not.toContain('새 이미지가 저장 대기 중입니다.');
    await act(async () => { clickButton('English'); press('[role="tab"][id$="-trigger-copy"]', 'Enter'); });
    await act(async () => { change('input#entryTitle', '저장하지 않을 전시 제목'); clickButton('Cancel'); });
    expect(document.querySelector('input#entryTitle')).toHaveProperty('value', '우리의 컬렉션');
    await act(async () => { press('[role="tab"][id$="-trigger-worklist"]', 'Enter'); });
    await act(async () => missingGame()!.click());
    await act(async () => {
      change('textarea', '이 게임은 같은 색의 카드를 모읍니다.');
      change('input[inputmode="url"]', 'https://example.com/complete-pin.webp');
    });
    await act(async () => { press('[role="tab"][id$="-trigger-worklist"]', 'Enter'); });
    expect(missingGame()).toBeDefined();
    await act(async () => missingGame()!.click());
    await act(async () => { clickButton('Save changes'); });
    await act(async () => { press('[role="tab"][id$="-trigger-worklist"]', 'Enter'); });
    expect(missingGame()).toBeUndefined();
  }, 15_000);
});

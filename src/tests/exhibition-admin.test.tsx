import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authChanged: undefined as ((user: { uid: string; email: string }) => void) | undefined,
  admin: vi.fn(),
  syncFailure: undefined as ((error: { step: string; code: string }) => void) | undefined,
  save: vi.fn(),
  retry: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: typeof mocks.authChanged) => {
    mocks.authChanged = callback;
    return () => {};
  },
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocsFromServer: async () => ({ docs: [{ id: 'source-game', data: () => ({ title: '운영 게임' }) }] }),
}));
vi.mock('../lib/firebase', () => ({
  auth: {}, db: {}, checkAdminStatus: mocks.admin, logout: vi.fn(), signInWithGoogle: vi.fn(),
}));
vi.mock('../services/exhibitionSyncService', () => ({
  loadExhibitionSettings: async () => ({ enabled: false, period: { kind: 'all' }, gameMapping: [] }),
  loadExhibitionStatus: async () => ({ pending: false, unmappedGameIds: ['source-game'], missingMemberIds: [] }),
  retryExhibitionRefresh: mocks.retry,
  saveExhibitionSettings: mocks.save,
  watchExhibitionSync: (_status: unknown, reportError: typeof mocks.syncFailure) => {
    mocks.syncFailure = reportError;
    return () => {};
  },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function clickButton(label: string) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  button.click();
}

function change(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
  if (!input) throw new Error(`Missing input: ${selector}`);
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

describe('exhibition admin settings', () => {
  it('checks the existing role and saves settings for automatic reflection', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    mocks.admin.mockResolvedValueOnce({ isAdmin: false }).mockResolvedValueOnce({ isAdmin: true });
    mocks.save.mockResolvedValue(undefined);
    mocks.retry.mockResolvedValue(undefined);
    await act(async () => { await import('../../exhibition-admin/main'); });

    await act(async () => { mocks.authChanged?.({ uid: 'visitor', email: 'visitor@example.invalid' }); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('관리자 권한이 필요합니다');
    await act(async () => { mocks.authChanged?.({ uid: 'operator', email: 'operator@example.invalid' }); });
    await act(async () => { mocks.syncFailure?.({ step: '전시 데이터 저장', code: 'permission-denied' }); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('전시 데이터 저장 (permission-denied)');
    await act(async () => {
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
      change('fieldset:first-of-type select', 'semester');
    });
    await act(async () => {
      change('input[name="semester"]', '2026-2');
      change('select[aria-label="운영 게임 전시 핀"]', 'avalon');
      change('textarea', ' 새 핀 설명 ');
    });
    await act(async () => { clickButton('설정 저장'); });
    expect(mocks.save).toHaveBeenCalledWith('avalon', {
      enabled: true, period: { kind: 'semester', semester: '2026-2' },
      gameMapping: [{ sourceId: 'source-game', pinId: 'avalon' }],
      descriptions: { avalon: '새 핀 설명' },
    });
    expect(document.body.textContent).toContain('설정을 저장했습니다. 전시에 자동 반영됩니다.');
    await act(async () => { clickButton('다시 반영'); });
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
});

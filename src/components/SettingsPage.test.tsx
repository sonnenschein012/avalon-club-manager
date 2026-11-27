import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './SettingsPage';

vi.mock('../hooks/useSettingsAdmins', () => ({ useSettingsAdmins: () => ({}) }));
vi.mock('../hooks/useClubExports', () => ({ useClubExports: () => ({}) }));
vi.mock('./SettingsAdminPanel', () => ({ default: () => <div>관리자 목록</div> }));
vi.mock('./SettingsExportPanel', () => ({ default: () => <div>내보내기</div> }));
vi.mock('./SettingsAuditPanel', () => ({ default: () => <div data-testid="audit-panel">변경 이력 패널</div> }));
const exhibition = vi.hoisted(() => ({ load: vi.fn(), retry: vi.fn() }));
vi.mock('../services/exhibitionSyncService', () => ({
  loadExhibitionStatus: exhibition.load, retryExhibitionRefresh: exhibition.retry,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('SettingsPage audit visibility', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows change history only to a master while admin edit mode is active', () => {
    const renderPage = (isMasterAdmin: boolean, isAdminModeActive: boolean) => act(() => root.render(
      <SettingsPage
        isMasterAdmin={isMasterAdmin}
        isAdminModeActive={isAdminModeActive}
        setIsAdminModeActive={vi.fn()}
      />,
    ));

    renderPage(true, false);
    expect(container.querySelector('[data-testid="audit-panel"]')).toBeNull();

    renderPage(false, true);
    expect(container.querySelector('[data-testid="audit-panel"]')).toBeNull();

    renderPage(true, true);
    expect(container.querySelector('[data-testid="audit-panel"]')?.textContent).toBe('변경 이력 패널');
  });

  it('shows the exhibition status and queues manual publication from settings', async () => {
    exhibition.load.mockResolvedValue({ published: true, pending: false, profileCount: 12, lastSyncedAt: new Date() });
    exhibition.retry.mockResolvedValue(undefined);
    const request = vi.fn();
    await act(async () => root.render(<SettingsPage isMasterAdmin={false} isAdminModeActive={false}
      setIsAdminModeActive={vi.fn()} exhibition={{ phase: 'idle', failure: null, request }} />));
    const panel = container.querySelector('section[aria-labelledby="exhibition-settings-heading"]');
    expect(panel?.textContent).toContain('공개 기록 반영 완료');
    expect(panel?.textContent).toContain('컬렉션 12개');
    expect(panel?.querySelector('a')?.getAttribute('href')).toBe('https://avalon-collection-studio.web.app/');
    await act(async () => panel?.querySelector('button')?.click());
    expect(exhibition.retry).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });
});

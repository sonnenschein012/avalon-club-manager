import pins from '../../../exhibition/games.json';

export interface ExhibitionPin {
  ko: string;
  en?: string;
  motif?: string;
  pending?: boolean;
}

export const exhibitionPins: Record<string, ExhibitionPin> = pins;
export const exhibitionCopy = {
  entryTitle: 'Your Collection',
  edition: 'AVALON / VOL. 06',
  namePrompt: '이름을 입력해 주세요',
  collectionTitle: 'My Collection',
  pinHint: '핀을 고르면 함께한 날의 기록이 열립니다.',
  archiveTitle: '함께한 날',
  groupLabel: '같은 조에 있었던 사람',
  companionsLabel: '함께 플레이한 사람',
  labelsToggle: '이름표',
  anotherName: '다른 이름으로 보기',
  allDates: '전체',
  clearFilter: '필터 해제',
  fallbackPin: '게임 기록',
  checkingName: '기록을 확인하는 중입니다.',
  sameName: '같은 이름의 기록이 있어 해당 항목을 선택해 주세요.',
  loadingRecord: '기록을 불러오는 중입니다.',
  missingRecord: '이 기록을 찾지 못했습니다.',
  loadError: '기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  unpublished: '현재 볼 수 있는 기록이 없습니다.',
  noNameMatch: '기록에서 해당 이름을 찾지 못했습니다. 이름을 다시 확인해 주세요.',
  noGames: '플레이한 게임이 기록되어 있지 않습니다.',
  noDayGames: '이날 플레이한 게임은 기록되어 있지 않습니다.',
  noCompanionGames: '함께 플레이한 게임이 기록되어 있지 않습니다.',
} as const;
export type ExhibitionCopy = Partial<Record<keyof typeof exhibitionCopy, string>>;
export type ExhibitionVisibility = 'public' | 'private' | 'temporary';
export interface ExhibitionSchedule { start: string; end: string }

export function exhibitionPublicationWindow(schedule: ExhibitionSchedule) {
  const parse = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
    const utc = Date.parse(date + 'T00:00:00Z');
    return Number.isFinite(utc) && new Date(utc).toISOString().slice(0, 10) === date
      ? utc - 9 * 60 * 60_000 : NaN;
  };
  const start = parse(schedule.start);
  const end = parse(schedule.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  return { start: new Date(start), end: new Date(end + 24 * 60 * 60_000) };
}

export function normalizeExhibitionGameTitle(title: string) {
  return title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

const aliases: Record<string, string> = { 아발론: 'avalon', 레지스탕스아발론: 'avalon', 카멜업2판: 'camel' };

export function defaultExhibitionPin(id: string, title: string) {
  const normalized = normalizeExhibitionGameTitle(title);
  const matches = Object.entries(exhibitionPins).filter(([, pin]) => normalized && [pin.ko, ...(pin.en ?? '').split(' / ')]
    .some(name => normalizeExhibitionGameTitle(name) === normalized));
  return (Object.hasOwn(aliases, normalized) ? aliases[normalized] : undefined)
    ?? (matches.length === 1 ? matches[0]?.[0] : undefined)
    ?? fallbackExhibitionPin(id);
}

export function fallbackExhibitionPin(id: string) {
  return 'game-' + Array.from(new TextEncoder().encode(id), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function exhibitionImageUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 400
      ? url.href : undefined;
  } catch {
    return undefined;
  }
}

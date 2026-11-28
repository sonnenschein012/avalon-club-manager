import type { Session, StoredSessionGroup } from '../../types';
import { koreaDateKey } from '../shared/koreaDate';

type SessionInput = { date?: Session['date'] | string; groups?: readonly StoredSessionGroup[] };

export interface ExhibitionSourceGroup {
  id: string;
  memberIds: string[];
  gameIds: string[];
}

export interface ExhibitionSourceSession {
  date: string;
  groups: ExhibitionSourceGroup[];
}

export type ExhibitionSessionChange =
  | { kind: 'created' | 'deleted'; session: ExhibitionSourceSession }
  | { kind: 'updated'; date?: { before: string; after: string }; groups: ExhibitionGroupChange[] }
  | { kind: 'imported'; sessionIds: string[] };

type IdChange = { removed: string[]; added: string[] };
type ExhibitionGroupChange =
  | { kind: 'added' | 'removed'; group: ExhibitionSourceGroup }
  | { kind: 'updated'; id: string; members?: IdChange; games?: IdChange };

function ids(values: readonly string[] = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function projectExhibitionSession(session: SessionInput): ExhibitionSourceSession {
  const date = typeof session.date === 'string' ? new Date(session.date) : session.date?.toDate();
  const occurrences = new Map<string, number>();
  const groups = (session.groups ?? []).map(group => {
    // Legacy groups can have blank or repeated IDs. Keep their occurrences distinct.
    const id = group.id ?? '';
    const occurrence = (occurrences.get(id) ?? 0) + 1;
    occurrences.set(id, occurrence);
    return { id: JSON.stringify([id, occurrence]), memberIds: ids(group.memberIds), gameIds: ids(group.gameIds) };
  });
  return { date: date && Number.isFinite(date.getTime()) ? koreaDateKey(date) : '', groups };
}

function difference(before: string[], after: string[]): IdChange | undefined {
  const previous = new Set(before);
  const next = new Set(after);
  const removed = before.filter(id => !next.has(id));
  const added = after.filter(id => !previous.has(id));
  if (removed.length || added.length) return { removed, added };
}

export function exhibitionSessionChange(
  before: ExhibitionSourceSession | null,
  after: ExhibitionSourceSession | null,
): ExhibitionSessionChange | undefined {
  if (!before) return after ? { kind: 'created', session: after } : undefined;
  if (!after) return { kind: 'deleted', session: before };

  const previous = new Map(before.groups.map(group => [group.id, group]));
  const groups: ExhibitionGroupChange[] = [];
  for (const group of after.groups) {
    const old = previous.get(group.id);
    if (!old) {
      groups.push({ kind: 'added', group });
      continue;
    }
    previous.delete(group.id);
    const members = difference(old.memberIds, group.memberIds);
    const games = difference(old.gameIds, group.gameIds);
    if (members || games) groups.push({ kind: 'updated', id: group.id, ...(members && { members }), ...(games && { games }) });
  }
  for (const group of previous.values()) groups.push({ kind: 'removed', group });
  const date = before.date !== after.date ? { before: before.date, after: after.date } : undefined;
  if (date || groups.length) return { kind: 'updated', ...(date && { date }), groups };
}

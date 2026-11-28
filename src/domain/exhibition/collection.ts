import type { Session } from '../../types';
import { normalizeMemberName } from '../members/memberIdentity';
import { getSemester } from '../semester/getSemester';
import { koreaDateKey } from '../shared/koreaDate';
import { fallbackExhibitionPin } from './presentation';

export type ExhibitionPeriod =
  | { kind: 'all' }
  | { kind: 'semester'; semester: string }
  | { kind: 'range'; start: string; end: string; semesters?: { start: string; end: string } };

interface ExhibitionMember {
  id: string;
  name: string;
  yearLabel?: string;
}

interface RecordedGames {
  gameIds: string[];
  gameCounts?: Record<string, number>;
}

interface Companion {
  gameIds: string[];
  groupCount?: number;
  profileId: string;
  name: string;
}

interface ExhibitionDay extends RecordedGames {
  date: string;
  companions: Companion[];
}

export interface ExhibitionProfile {
  name: string;
  days: ExhibitionDay[];
  gameTitles?: Record<string, string>;
  gamePins?: Record<string, string>;
}

interface PublicParticipant {
  profileId: string;
  name: string;
}

export interface PublicExhibitionSession {
  date: string;
  groups: { participants: PublicParticipant[]; gameIds: string[] }[];
}

export interface ExhibitionParticipation {
  name: string;
  sessionIds: string[];
}

interface NameCandidate {
  profileId: string;
  yearLabel?: string;
}

async function documentKey(parts: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export const exhibitionSessionKey = (exhibitionId: string, sessionId: string) => documentKey([exhibitionId, 'session', sessionId]);
export const exhibitionProfileKey = (exhibitionId: string, memberId: string) => documentKey([exhibitionId, memberId]);

/** Exact lookup key shared by the administrator and public clients. */
export async function exhibitionNameKey(name: string): Promise<string | null> {
  const normalized = normalizeMemberName(name.normalize('NFC'));
  return normalized ? documentKey([normalized]) : null;
}

function includesDate(period: ExhibitionPeriod, date: string): boolean {
  switch (period.kind) {
    case 'all': return true;
    case 'semester': return getSemester(`${date}T12:00:00`) === period.semester;
    case 'range': return date >= period.start && date <= period.end;
  }
}

function recordGroupGames(record: RecordedGames, gameIds: readonly string[]) {
  const counts = record.gameCounts ?? {};
  for (const id of gameIds) {
    if (Object.hasOwn(counts, id)) counts[id] = (counts[id] ?? 0) + 1;
    else Object.defineProperty(counts, id, { value: 1, enumerable: true, writable: true });
  }
  record.gameCounts = counts;
  record.gameIds = Object.keys(counts);
}

function recordParticipation(days: Map<string, ExhibitionDay>, profileId: string, date: string,
  participants: readonly PublicParticipant[], playedGames: readonly string[]) {
  const entry = days.get(date) ?? { date, gameIds: [], companions: [] };
  recordGroupGames(entry, playedGames);
  for (const peer of participants) {
    if (peer.profileId === profileId) continue;
    const previous = entry.companions.find(person => person.profileId === peer.profileId);
    const companion: Companion = previous ?? { profileId: peer.profileId, name: peer.name, gameIds: [] };
    companion.groupCount = (companion.groupCount ?? 0) + 1;
    companion.gameIds = [...new Set([...companion.gameIds, ...playedGames])];
    if (!previous) entry.companions.push(companion);
  }
  days.set(date, entry);
}

function sortExhibitionDays(days: Iterable<ExhibitionDay>) {
  return [...days].sort((a, b) => b.date.localeCompare(a.date));
}

export function exhibitionProfileFromSessions(profileId: string, participation: ExhibitionParticipation,
  sessions: readonly PublicExhibitionSession[]): ExhibitionProfile {
  const days = new Map<string, ExhibitionDay>();
  for (const session of sessions) for (const group of session.groups) {
    if (group.participants.some(member => member.profileId === profileId)) {
      recordParticipation(days, profileId, session.date, group.participants, group.gameIds);
    }
  }
  return { name: participation.name, days: sortExhibitionDays(days.values()) };
}

export async function buildExhibitionCollection(
  exhibitionId: string,
  period: ExhibitionPeriod,
  sessions: readonly (Pick<Session, 'groups'> & { id?: string; date: Session['date'] | string })[],
  members: readonly ExhibitionMember[],
  gameMapping: ReadonlyMap<string, string>,
  titlesBySourceId: ReadonlyMap<string, string> = new Map(),
) {
  const namedMembers = members.filter(member => normalizeMemberName(member.name));
  const identities = new Map(await Promise.all(namedMembers.map(async member => [
    member.id,
    { ...member, profileId: await exhibitionProfileKey(exhibitionId, member.id) },
  ] as const)));
  const daysByProfile = new Map<string, Map<string, ExhibitionDay>>();
  const unmappedGameIds = new Set<string>();
  const missingMemberIds = new Set<string>();
  const played = new Map<string, { title: string; pin: string | undefined }>();
  const publicSessions = new Map<string, PublicExhibitionSession>();
  const sessionsByProfile = new Map<string, Set<string>>();

  for (const session of sessions) {
    // Older sessions can store a calendar date string.
    const value = typeof session.date === 'string' ? new Date(session.date) : session.date.toDate();
    if (!Number.isFinite(value.getTime())) continue;
    const day = koreaDateKey(value);
    if (!includesDate(period, day)) continue;
    const publicId = session.id ? await exhibitionSessionKey(exhibitionId, session.id) : undefined;
    const publicGroups: PublicExhibitionSession['groups'] = [];

    for (const group of session.groups) {
      const participants = [...new Set(group.memberIds ?? [])].flatMap(id => {
        const member = identities.get(id);
        if (member) return [member];
        missingMemberIds.add(id);
        return [];
      });
      const gameIds = new Set<string>();
      for (const id of group.gameIds ?? []) {
        const mappedId = gameMapping.get(id);
        const pin = mappedId && !mappedId.startsWith('game-') ? mappedId : undefined;
        if (!pin) unmappedGameIds.add(id);
        const title = titlesBySourceId.get(id);
        if (!title && !pin) continue;
        const gameId = fallbackExhibitionPin(id);
        played.set(gameId, { title: title ?? '', pin });
        gameIds.add(gameId);
      }

      const playedGames = [...gameIds];
      if (publicId && participants.length) publicGroups.push({
        participants: participants.map(({ profileId, name }) => ({ profileId, name })), gameIds: playedGames,
      });
      for (const member of participants) {
        const days = daysByProfile.get(member.profileId) ?? new Map<string, ExhibitionDay>();
        recordParticipation(days, member.profileId, day, participants, playedGames);
        daysByProfile.set(member.profileId, days);
        if (publicId) {
          const links = sessionsByProfile.get(member.profileId) ?? new Set();
          links.add(publicId);
          sessionsByProfile.set(member.profileId, links);
        }
      }
    }
    if (publicId && publicGroups.length) publicSessions.set(publicId, { date: day, groups: publicGroups });
  }

  const profiles = new Map<string, ExhibitionProfile>();
  const participation = new Map<string, ExhibitionParticipation>();
  const names = new Map<string, { candidates: NameCandidate[] }>();
  for (const member of identities.values()) {
    const days = daysByProfile.get(member.profileId);
    const nameKey = days && await exhibitionNameKey(member.name);
    if (!days || !nameKey) continue;
    const links = sessionsByProfile.get(member.profileId);
    if (links) participation.set(member.profileId, { name: member.name, sessionIds: [...links] });

    const sortedDays = sortExhibitionDays(days.values());
    const ids = [...new Set(sortedDays.flatMap(day => day.gameIds))];
    const gameTitles = Object.fromEntries(ids.flatMap(id => {
      const title = played.get(id)?.title;
      return title ? [[id, title] as const] : [];
    }));
    const gamePins = Object.fromEntries(ids.flatMap(id => {
      const pin = played.get(id)?.pin;
      return pin ? [[id, pin] as const] : [];
    }));
    profiles.set(member.profileId, {
      name: member.name,
      days: sortedDays,
      ...(Object.keys(gameTitles).length ? { gameTitles } : {}),
      ...(Object.keys(gamePins).length ? { gamePins } : {}),
    });
    const match = names.get(nameKey) ?? { candidates: [] };
    match.candidates.push({ profileId: member.profileId, ...(member.yearLabel && /^\d{2}$/u.test(member.yearLabel) ? { yearLabel: member.yearLabel } : {}) });
    names.set(nameKey, match);
  }
  for (const match of names.values()) {
    const [candidate] = match.candidates;
    if (candidate && match.candidates.length === 1) {
      match.candidates = [{ profileId: candidate.profileId }];
    }
  }

  const visibleGameIds = new Set([...profiles.values()].flatMap(profile => profile.days.flatMap(day => day.gameIds)));
  const publicGames = [...played].filter(([id]) => visibleGameIds.has(id));
  const gameTitles = Object.fromEntries(publicGames.flatMap(([id, game]) => game.title ? [[id, game.title]] : []));
  const gamePins = Object.fromEntries(publicGames.flatMap(([id, game]) => game.pin ? [[id, game.pin]] : []));
  return { profiles, names, participation, publicSessions, gameTitles, gamePins,
    unmappedGameIds: [...unmappedGameIds].sort(), missingMemberIds: [...missingMemberIds].sort() };
}

/** Provide each pin once with the dates it was played, optionally with one companion. */
export function exhibitionGames(
  profile: ExhibitionProfile,
  selection: { date?: string; companionId?: string } = {},
): Map<string, string[]> {
  const datesByGame = new Map<string, string[]>();
  for (const day of profile.days) {
    if (selection.date && selection.date !== day.date) continue;
    const games = selection.companionId
      ? day.companions.find(person => person.profileId === selection.companionId)?.gameIds ?? []
      : day.gameIds;
    for (const game of games) {
      const dates = datesByGame.get(game) ?? [];
      dates.push(day.date);
      datesByGame.set(game, dates);
    }
  }
  return datesByGame;
}

const byKoreanName = new Intl.Collator('ko');

export function rankedCompanions(days: readonly ExhibitionDay[]) {
  const people = new Map<string, { profileId: string; name: string; count: number; recent: string; games: Set<string> }>();
  for (const day of days) {
    for (const person of day.companions) {
      const entry = people.get(person.profileId) ?? { profileId: person.profileId, name: person.name, count: 0, recent: '', games: new Set<string>() };
      entry.count += person.groupCount ?? 1;
      if (day.date > entry.recent) entry.recent = day.date;
      for (const game of person.gameIds) entry.games.add(game);
      people.set(person.profileId, entry);
    }
  }
  return [...people.values()].sort((a, b) =>
    b.count - a.count || b.recent.localeCompare(a.recent) || b.games.size - a.games.size ||
    byKoreanName.compare(a.name, b.name) || a.profileId.localeCompare(b.profileId));
}

export function rankedGames(days: readonly ExhibitionDay[], tieRanks: ReadonlyMap<string, number> = new Map()) {
  const games = new Map<string, { id: string; count: number; recent: string }>();
  for (const day of days) {
    for (const id of day.gameIds) {
      const total = games.get(id) ?? { id, count: 0, recent: '' };
      total.count += day.gameCounts?.[id] ?? 1;
      if (day.date > total.recent) total.recent = day.date;
      games.set(id, total);
    }
  }
  return [...games.values()].sort((a, b) =>
    b.count - a.count || b.recent.localeCompare(a.recent) ||
    (tieRanks.get(a.id) ?? 0) - (tieRanks.get(b.id) ?? 0) || a.id.localeCompare(b.id)).map(game => game.id);
}

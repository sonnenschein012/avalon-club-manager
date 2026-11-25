import type { Session } from '../../types';
import { normalizeMemberName } from '../members/memberIdentity';
import { getSemester } from '../semester/getSemester';
import { koreaDateKey } from '../shared/koreaDate';

export type ExhibitionPeriod =
  | { kind: 'all' }
  | { kind: 'semester'; semester: string }
  | { kind: 'range'; start: string; end: string };

interface ExhibitionMember {
  id: string;
  name: string;
  yearLabel?: string;
}

interface Companion {
  profileId: string;
  name: string;
  gameIds: string[];
}

interface ExhibitionDay {
  date: string;
  gameIds: string[];
  companions: Companion[];
}

export interface ExhibitionProfile {
  name: string;
  days: ExhibitionDay[];
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

export async function buildExhibitionCollection(
  exhibitionId: string,
  period: ExhibitionPeriod,
  sessions: readonly (Pick<Session, 'groups'> & { date: Session['date'] | string })[],
  members: readonly ExhibitionMember[],
  gameMapping: ReadonlyMap<string, string>,
) {
  const namedMembers = members.filter(member => normalizeMemberName(member.name));
  const identities = new Map(await Promise.all(namedMembers.map(async member => [
    member.id,
    { ...member, profileId: await documentKey([exhibitionId, member.id]) },
  ] as const)));
  const daysByProfile = new Map<string, Map<string, ExhibitionDay>>();
  const unmappedGameIds = new Set<string>();
  const missingMemberIds = new Set<string>();

  for (const session of sessions) {
    // Older sessions can store a calendar date string.
    const value = typeof session.date === 'string' ? new Date(session.date) : session.date.toDate();
    if (!Number.isFinite(value.getTime())) continue;
    const day = koreaDateKey(value);
    if (!includesDate(period, day)) continue;

    for (const group of session.groups) {
      const participants = [...new Set(group.memberIds ?? [])].flatMap(id => {
        const member = identities.get(id);
        if (member) return [member];
        missingMemberIds.add(id);
        return [];
      });
      const gameIds = (group.gameIds ?? []).flatMap(id => {
        const mappedId = gameMapping.get(id);
        if (mappedId) return [mappedId];
        unmappedGameIds.add(id);
        return [];
      });

      for (const member of participants) {
        const days = daysByProfile.get(member.profileId) ?? new Map<string, ExhibitionDay>();
        const entry = days.get(day) ?? { date: day, gameIds: [], companions: [] };
        entry.gameIds = [...new Set([...entry.gameIds, ...gameIds])];
        for (const peer of participants) {
          if (peer.id === member.id) continue;
          const previous = entry.companions.find(person => person.profileId === peer.profileId);
          if (previous) {
            previous.gameIds = [...new Set([...previous.gameIds, ...gameIds])];
          } else {
            entry.companions.push({ profileId: peer.profileId, name: peer.name, gameIds: [...new Set(gameIds)] });
          }
        }
        days.set(day, entry);
        daysByProfile.set(member.profileId, days);
      }
    }
  }

  const profiles = new Map<string, ExhibitionProfile>();
  const names = new Map<string, { candidates: NameCandidate[] }>();
  for (const member of identities.values()) {
    const days = daysByProfile.get(member.profileId);
    const nameKey = days && await exhibitionNameKey(member.name);
    if (!days || !nameKey) continue;

    profiles.set(member.profileId, {
      name: member.name,
      days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)),
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

  return { profiles, names, unmappedGameIds: [...unmappedGameIds].sort(), missingMemberIds: [...missingMemberIds].sort() };
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

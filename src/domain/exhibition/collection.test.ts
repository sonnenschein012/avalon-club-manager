import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { buildExhibitionCollection, exhibitionGames, exhibitionNameKey, rankedGames, rankedCompanions } from './collection';
import type { Session } from '../../types';
import { fallbackExhibitionPin } from './presentation';

const members = [
  { id: 'a', name: '가람' },
  { id: 'b', name: '한결', yearLabel: '25' },
  { id: 'c', name: '한결', yearLabel: '26' },
  { id: 'inactive', name: '미참석' },
];
const mapping = new Map([['x', 'pin-x'], ['alias-x', 'pin-x'], ['y', 'pin-y'], ['z', 'pin-z']]);
const game = fallbackExhibitionPin;

function session(id: string, utc: string, groups: [string[], string[]][]): Session {
  return {
    id,
    name: '합성 세션',
    date: Timestamp.fromDate(new Date(utc)),
    groups: groups.map(([memberIds, gameIds], index) => ({ id: String(index), memberIds, gameIds })),
  };
}

const sessions = [
  session('1', '2026-08-31T15:10:00Z', [[['a', 'b', 'b'], ['x', 'alias-x', 'unknown']]]),
  session('2', '2026-09-01T05:00:00Z', [[['a', 'c'], ['y', 'z']], [['b'], ['z']]]),
  session('3', '2026-09-02T05:00:00Z', [[['a', 'b', 'missing'], ['x', 'y']]]),
  session('4', '2026-08-31T14:59:59Z', [[['a'], ['z']]]),
];

async function nameKey(name: string) {
  return (await exhibitionNameKey(name))!;
}

describe('exhibition collection', () => {
  it('normalizes name lookup and distinguishes same-name companions by ID', async () => {
    const result = await buildExhibitionCollection('first', { kind: 'all' }, sessions, members, mapping);
    const a = result.names.get(await nameKey(' 가 람 '.normalize('NFD')))!.candidates[0];
    const [b, c] = result.names.get(await nameKey('한결'))!.candidates;
    if (!a || !b || !c) throw new Error('Expected a profile and two same-name candidates');
    const profile = result.profiles.get(a.profileId)!;

    expect([b.yearLabel, c.yearLabel]).toEqual(['25', '26']);
    expect(b.profileId).not.toBe(c.profileId);
    expect(result.names.has(await nameKey('미참석'))).toBe(false);
    expect(await exhibitionNameKey('  ')).toBeNull();
    expect(result.unmappedGameIds).toEqual(['unknown']);
    expect(result.missingMemberIds).toEqual(['missing']);
    expect(exhibitionGames(profile, { date: '2026-09-01' })).toEqual(
      new Map([[game('x'), ['2026-09-01']], [game('alias-x'), ['2026-09-01']], [game('y'), ['2026-09-01']], [game('z'), ['2026-09-01']]]),
    );
    expect(exhibitionGames(profile, { date: '2026-09-01', companionId: b.profileId })).toEqual(
      new Map([[game('x'), ['2026-09-01']], [game('alias-x'), ['2026-09-01']]]),
    );
    expect(exhibitionGames(profile, { date: '2026-09-01', companionId: c.profileId })).toEqual(
      new Map([[game('y'), ['2026-09-01']], [game('z'), ['2026-09-01']]]),
    );
    expect(exhibitionGames(profile, { companionId: b.profileId })).toEqual(
      new Map([[game('x'), ['2026-09-02', '2026-09-01']], [game('y'), ['2026-09-02']], [game('alias-x'), ['2026-09-01']]]),
    );
  });

  it('applies inclusive Korean date ranges and removes deleted sessions on rebuild', async () => {
    const range = { kind: 'range', start: '2026-09-01', end: '2026-09-02' } as const;
    const first = await buildExhibitionCollection('first', range, sessions, members, mapping);
    const next = await buildExhibitionCollection('first', range, sessions.slice(1), members, mapping);
    const key = await nameKey('가람');
    const firstId = first.names.get(key)!.candidates[0]?.profileId;
    if (!firstId) throw new Error('Expected a profile');
    expect(next.names.get(key)!.candidates[0]?.profileId).toBe(firstId);
    expect(first.profiles.get(firstId)!.days.map(day => day.date)).toEqual(['2026-09-02', '2026-09-01']);
    expect(next.profiles.get(firstId)!.days[1]?.gameIds).toEqual([game('y'), game('z')]);
  });

  it('reuses the club semester rollover through February', async () => {
    const winter = session('winter', '2027-02-28T14:59:59Z', [[['a'], ['x']]]);
    const spring = session('spring', '2027-02-28T15:00:00Z', [[['a'], ['y']]]);
    const result = await buildExhibitionCollection(
      'first', { kind: 'semester', semester: '2026-2' }, [winter, spring], members, mapping,
    );
    const candidate = result.names.get(await nameKey('가람'))?.candidates[0];
    if (!candidate) throw new Error('Expected a semester profile');
    const { profileId } = candidate;
    expect(exhibitionGames(result.profiles.get(profileId)!)).toEqual(new Map([[game('x'), ['2027-02-28']]]));
  });
});

it('counts games that reuse artwork separately and ranks shared groups across sessions', async () => {
  const records = [
    session('alpha', '2026-09-02T05:00:00Z', [[['a', 'b'], ['x', 'alias-x']], [['a', 'c'], ['y']]]),
    session('beta', '2026-09-02T06:00:00Z', [[['a', 'b'], ['x']]]),
  ];
  const result = await buildExhibitionCollection('first', { kind: 'all' }, records, members, mapping);
  const key = await nameKey('가람');
  const id = result.names.get(key)?.candidates[0]?.profileId;
  if (!id) throw new Error('Expected profile');
  const profile = result.profiles.get(id)!;
  expect(profile.days[0]?.gameCounts).toEqual({ [game('x')]: 2, [game('alias-x')]: 1, [game('y')]: 1 });
  expect(profile.gamePins).toMatchObject({ [game('x')]: 'pin-x', [game('alias-x')]: 'pin-x' });
  expect(rankedGames(profile.days, new Map())).toEqual([game('x'), game('alias-x'), game('y')]);
  expect(rankedCompanions(profile.days).map(person => person.count)).toEqual([2, 1]);
});

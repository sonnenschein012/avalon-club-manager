import { createExhibitionReader } from '../../exhibition/reader';
import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from 'vitest';
import * as fs from 'fs';
import { initializeTestEnvironment, RulesTestEnvironment, type RulesTestContext, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  collection,
  Timestamp,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { loadExhibitionSettings, loadExhibitionStatus, refreshExhibitions, retryExhibitionRefresh, saveExhibitionSettings, watchExhibitionSync } from '../services/exhibitionSyncService';
import { importSessionRecords, updateSessionGroupGames, deleteSessionRecord } from '../services/sessionsService';
import { requestExhibitionRefresh } from '../services/exhibitionRevision';
import { exhibitionNameKey } from '../domain/exhibition/collection';

const sync = vi.hoisted(() => ({ db: undefined as ReturnType<RulesTestContext['firestore']> | undefined, beforeBuild: undefined as (() => Promise<void>) | undefined }));
vi.mock('../lib/firebase', () => ({ get db() { return sync.db; }, auth: { currentUser: { email: 'regular@example.com' } } }));
vi.mock('../domain/exhibition/collection', async importOriginal => {
  const actual = await importOriginal<typeof import('../domain/exhibition/collection')>();
  return { ...actual, buildExhibitionCollection: async (...args: Parameters<typeof actual.buildExhibitionCollection>) => {
    await sync.beforeBuild?.();
    return actual.buildExhibitionCollection(...args);
  } };
});

let testEnv: RulesTestEnvironment | undefined;

const REGULAR_ADMIN_EMAIL = 'regular@example.com';
const FORMER_BOOTSTRAP_EMAIL = 'eunchangyang1@gmail.com';
const MASTER_ADMIN_EMAIL = 'master@example.com';
const ALLOWED_SLOT_A = '2026-08-25|18:00';
const ALLOWED_SLOT_B = '2026-08-25|18:30';

interface InterviewFixtureOptions {
  roundId?: string;
  token?: string;
  applicantId?: string;
  roundActive?: boolean;
  tokenActive?: boolean;
  status?: string;
  surveyOpensAt?: Date;
  surveyClosesAt?: Date;
}

async function seedRegularAdmin(email = REGULAR_ADMIN_EMAIL) {
  if (!testEnv) throw new Error('testEnv not initialized');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'admins', email), {
      email,
      role: 'admin',
      createdAt: new Date(),
    });
  });
}

async function seedMasterAdmin(email = MASTER_ADMIN_EMAIL) {
  if (!testEnv) throw new Error('testEnv not initialized');
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'admins', email), { email, role: 'master', createdAt: new Date() });
  });
}

async function seedInterviewFixture(options: InterviewFixtureOptions = {}) {
  if (!testEnv) throw new Error('testEnv not initialized');

  const now = Date.now();
  const roundId = options.roundId ?? 'round-1';
  const token = options.token ?? 'secure-token-1';
  const applicantId = options.applicantId ?? 'applicant-1';

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'interviewRounds', roundId), {
      name: '2026-2 전화 면접',
      status: options.status ?? 'collecting',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await setDoc(doc(db, 'interviewPublicRounds', roundId), {
      name: '2026-2 전화 면접',
      surveyOpensAt: options.surveyOpensAt ?? new Date(now - 60 * 60 * 1000),
      surveyClosesAt: options.surveyClosesAt ?? new Date(now + 60 * 60 * 1000),
      interviewDates: ['2026-08-25'],
      dayStartTime: '18:00',
      dayEndTime: '20:00',
      availabilitySlotMinutes: 30,
      status: options.status ?? 'collecting',
      instructions: '가능한 시간을 모두 선택해 주세요.',
      allowedSlots: [ALLOWED_SLOT_A, ALLOWED_SLOT_B],
      active: options.roundActive ?? true,
      schemaVersion: 1,
      updatedAt: new Date(),
    });
    await setDoc(doc(db, 'interviewApplicants', applicantId), {
      roundId,
      applicantNumber: '001',
      name: '지원자',
      phone: '01000000000',
      accessToken: token,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await setDoc(doc(db, 'interviewAccess', token), {
      roundId,
      applicantId,
      displayName: '지원자',
      availability: [],
      submittedAt: null,
      updatedAt: null,
      responseUpdatedAt: null,
      firstAccessedAt: new Date(),
      active: options.tokenActive ?? true,
      createdAt: new Date(),
    });
  });

  return { roundId, token, applicantId };
}

async function seedScheduledInterviewFixture() {
  if (!testEnv) throw new Error('testEnv not initialized');
  const fixture = await seedInterviewFixture({ roundId: 'scheduled-round', token: 'scheduled-token', applicantId: 'scheduled-applicant' });
  const scheduleId = 'schedule-1';
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'interviewSchedules', scheduleId), {
      roundId: fixture.roundId,
      name: '8월 4주 면접',
      status: 'collecting',
      order: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await setDoc(doc(db, 'interviewPublicSchedules', scheduleId), {
      roundId: fixture.roundId,
      surveyOpensAt: new Date(Date.now() - 60 * 60 * 1000),
      surveyClosesAt: new Date(Date.now() + 60 * 60 * 1000),
      interviewDates: ['2026-08-25'],
      dayStartTime: '18:00',
      dayEndTime: '20:00',
      availabilitySlotMinutes: 30,
      instructions: '가능한 시간을 모두 선택해 주세요.',
      allowedSlots: [ALLOWED_SLOT_A, ALLOWED_SLOT_B],
      active: true,
      schemaVersion: 1,
      updatedAt: new Date(),
    });
    await updateDoc(doc(db, 'interviewApplicants', fixture.applicantId), { scheduleId });
    await updateDoc(doc(db, 'interviewAccess', fixture.token), { scheduleId });
  });
  return { ...fixture, scheduleId };
}

describe('Firestore Security Rules', () => {
  beforeAll(async () => {
    // Read the firestore.rules file
    const rules = fs.readFileSync('firestore.rules', 'utf8');
    try {
      testEnv = await initializeTestEnvironment({
        projectId: 'test-project-1234',
        firestore: { rules, host: '127.0.0.1', port: 8080 },
      });
    } catch (e) {
      console.warn('Firestore emulator is not running, failing test setup.', e);
      throw new Error('Firestore emulator must be running to test security rules.', { cause: e });
    }
  });

  afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    if (testEnv) await testEnv.clearFirestore();
  });

  it('비로그인 → 모든 컬렉션 거부', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const unauthedDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(unauthedDb, 'members')));
    await assertFails(setDoc(doc(unauthedDb, 'members', 'm1'), { name: 'test' }));
    await assertFails(getDocs(collection(unauthedDb, 'interviewRounds')));
    await assertFails(setDoc(doc(unauthedDb, 'interviewNotes', 'note-1'), { generalNotes: 'test' }));
  });

  it('allows only exact reads of the active exhibition generation without login', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedRegularAdmin();
    const admin = testEnv.authenticatedContext('exhibition-admin', { email: REGULAR_ADMIN_EMAIL }).firestore();
    const visitor = testEnv.unauthenticatedContext().firestore();
    const root = 'exhibitionAccess/season';
    const active = `${root}/generations/active`;
    const staged = `${root}/generations/staged`;

    await assertSucceeds(setDoc(doc(admin, root), { enabled: true, generationId: 'active' }));
    await assertSucceeds(setDoc(doc(admin, `${active}/names/name-key`), { candidates: [{ profileId: 'profile-id' }] }));
    await assertSucceeds(setDoc(doc(admin, `${active}/profiles/profile-id`), { name: '합성 부원', days: [] }));
    await assertSucceeds(setDoc(doc(admin, `${staged}/profiles/profile-id`), { name: '변경 부원', days: [] }));
    await assertSucceeds(getDoc(doc(visitor, root)));
    await assertSucceeds(getDoc(doc(visitor, `${active}/names/name-key`)));
    const missing = await assertSucceeds(getDoc(doc(visitor, `${active}/names/unknown`)));
    if (missing.exists()) throw new Error('Unexpected lookup result');
    await assertSucceeds(getDoc(doc(visitor, `${active}/profiles/profile-id`)));
    await assertFails(getDoc(doc(visitor, `${staged}/profiles/profile-id`)));
    await assertFails(getDocs(collection(visitor, 'exhibitionAccess')));
    await assertFails(getDocs(collection(visitor, `${active}/names`)));
    await assertFails(getDocs(collection(visitor, `${active}/profiles`)));
    await assertFails(getDoc(doc(visitor, 'members/member-id')));
    await assertFails(getDoc(doc(visitor, 'sessions/session-id')));
    await assertFails(updateDoc(doc(visitor, root), { generationId: 'staged' }));
    await assertFails(setDoc(doc(admin, `${active}/profiles/wrong`), { name: '합성', days: [], phone: 'private' }));
    await assertSucceeds(updateDoc(doc(admin, root), { generationId: 'staged' }));
    await assertFails(getDoc(doc(visitor, `${active}/profiles/profile-id`)));
    await assertSucceeds(getDoc(doc(visitor, `${staged}/profiles/profile-id`)));
    await assertSucceeds(updateDoc(doc(admin, root), { enabled: false }));
    await assertFails(getDoc(doc(visitor, root)));
    await assertFails(getDoc(doc(visitor, `${staged}/profiles/profile-id`)));
    await testEnv.withSecurityRulesDisabled(async context => {
      await deleteDoc(doc(context.firestore(), 'admins', REGULAR_ADMIN_EMAIL));
    });
    await assertFails(updateDoc(doc(admin, root), { enabled: true }));
  });

  it('resumes durable exhibition updates and rejects an obsolete calculation', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedRegularAdmin();
    const operator = testEnv.authenticatedContext('sync-admin', { email: REGULAR_ADMIN_EMAIL }).firestore();
    const visitor = testEnv.unauthenticatedContext().firestore();
    sync.db = operator;
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'members/a'), { name: '합성 부원', studentId: '26' });
    });
    await saveExhibitionSettings('season', { enabled: true, period: { kind: 'all' },
      gameMapping: [{ sourceId: 'game', pinId: 'pin' }] });
    const batch = writeBatch(operator);
    batch.set(doc(operator, 'sessions/first'), { name: '합성', date: Timestamp.fromDate(new Date('2026-09-01')),
      groups: [{ id: 'group', memberIds: ['a'], gameIds: ['game'] }] });
    await batch.commit();

    const access = 'exhibitionAccess/season';
    await assertFails(getDoc(doc(visitor, access)));
    expect(await refreshExhibitions()).toBe(true);
    const initial = (await getDoc(doc(visitor, access))).data()?.generationId;
    const nameKey = await exhibitionNameKey('합성 부원');
    expect((await getDoc(doc(visitor, `${access}/generations/${initial}/names/${nameKey}`))).exists()).toBe(true);

    await saveExhibitionSettings('season', { enabled: true, period: { kind: 'all' }, gameMapping: [] });
    let releaseBuild!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const hold = new Promise<void>(resolve => { releaseBuild = resolve; });
    sync.beforeBuild = () => { markStarted(); return hold; };
    const obsolete = refreshExhibitions();
    try {
      await started;
      const remove = writeBatch(operator);
      remove.delete(doc(operator, 'sessions/first'));
      await remove.commit();
      sync.beforeBuild = undefined;
      expect(await refreshExhibitions()).toBe(true);
    } finally {
      sync.beforeBuild = undefined;
      releaseBuild();
    }
    expect(await obsolete).toBe(false);
    const latest = (await getDoc(doc(visitor, access))).data()?.generationId;
    expect(latest).not.toBe(initial);
    await assertFails(getDoc(doc(visitor, `${access}/generations/${initial}/names/${nameKey}`)));
    expect((await getDoc(doc(operator, `${access}/generations/${initial}`))).exists()).toBe(false);
    expect((await getDocs(collection(operator, `${access}/generations/${initial}/profiles`))).empty).toBe(true);
    await assertFails(deleteDoc(doc(operator, `${access}/generations/${latest}`)));
    expect((await getDoc(doc(operator, `${access}/generations/${latest}`))).exists()).toBe(true);
    expect((await getDoc(doc(visitor, `${access}/generations/${latest}/names/${nameKey}`))).exists()).toBe(false);
    expect(await refreshExhibitions()).toBe(true);
    expect((await getDoc(doc(visitor, access))).data()?.generationId).toBe(latest);
  }, 15_000);

  it('projects live operation writes through the same reader used by the public exhibition', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedRegularAdmin();
    const operator = testEnv.authenticatedContext('integration-admin', { email: REGULAR_ADMIN_EMAIL }).firestore();
    sync.db = operator;
    const visitor = testEnv.unauthenticatedContext().firestore();
    // Rules testing provides a compat instance, which the modular SDK unwraps.
    const publicReader = createExhibitionReader(visitor as unknown as import('firebase/firestore').Firestore, 'avalon');
    await testEnv.withSecurityRulesDisabled(async context => {
      const local = context.firestore();
      await setDoc(doc(local, 'members/a'), { name: '합성 가람', studentId: '26', phone: 'private' });
      await setDoc(doc(local, 'members/b'), { name: '합성 나래', studentId: '25' });
      await setDoc(doc(local, 'sessions/legacy'), { name: '이전 형식', date: '2026-09-01',
        groups: [{ id: 'old-group', memberIds: ['a'], gameIds: ['dixit'] }] });
    });
    await saveExhibitionSettings('avalon', { enabled: true, period: { kind: 'all' },
      gameMapping: ['avalon', 'coffee', 'dixit'].map(id => ({ sourceId: id, pinId: id })),
      descriptions: { avalon: '전시 담당 설명' } });
    expect((await loadExhibitionSettings('avalon'))?.descriptions).toEqual({ avalon: '전시 담당 설명' });
    await assertFails(getDoc(doc(visitor, 'exhibitionSettings/avalon')));
    await assertFails(updateDoc(doc(visitor, 'exhibitionSettings/avalon'), { enabled: false }));
    await importSessionRecords([{ id: 'meeting', name: '합성 모임', date: '2026-09-02',
      groups: [{ id: 'new-group', memberIds: ['a', 'b'], gameIds: ['avalon'] }] }]);
    expect(await refreshExhibitions()).toBe(true);
    const matches = await publicReader.findExhibitionMembers(' 합성 가람 ');
    const id = matches[0]!.profileId;
    expect((await publicReader.loadExhibitionView(id)).descriptions).toEqual({ avalon: '전시 담당 설명' });
    expect((await loadExhibitionStatus('avalon')).pending).toBe(false);
    await retryExhibitionRefresh();
    expect((await loadExhibitionStatus('avalon')).pending).toBe(true);
    let profile = await publicReader.loadExhibitionProfile(id);
    expect(profile?.days.map(day => day.gameIds)).toEqual([['avalon'], ['dixit']]);
    expect(profile?.days[0]?.companions[0]).toMatchObject({ name: '합성 나래', gameIds: ['avalon'] });
    expect(profile).not.toHaveProperty('phone');

    await updateSessionGroupGames('meeting', 'new-group', ['coffee']);
    await refreshExhibitions();
    profile = await publicReader.loadExhibitionProfile(id);
    expect(profile?.days[0]?.companions[0]?.gameIds).toEqual(['coffee']);
    await deleteSessionRecord('meeting');
    await refreshExhibitions();
    expect(await publicReader.findExhibitionMembers('합성 나래')).toEqual([]);
    expect((await publicReader.loadExhibitionProfile(id))?.days.map(day => day.gameIds)).toEqual([['dixit']]);
    await saveExhibitionSettings('avalon', { enabled: false, period: { kind: 'all' }, gameMapping: [] });
    await expect(publicReader.loadExhibitionProfile(id)).rejects.toThrow('현재 볼 수 있는 기록이 없습니다');
  }, 20_000);

  it('isolates source game edits and deletes from a rejected exhibition marker and recovers after repair', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedRegularAdmin();
    const operator = testEnv.authenticatedContext('isolation-admin', { email: REGULAR_ADMIN_EMAIL }).firestore();
    sync.db = operator;
    const marker = doc(operator, 'exhibitionSync/source');
    const meeting = doc(operator, 'sessions/isolated');
    await saveExhibitionSettings('avalon', { enabled: true, period: { kind: 'all' }, gameMapping: [] });
    await importSessionRecords([{ id: 'isolated', date: '2026-09-02', name: '합성',
      groups: [{ id: 'group', memberIds: [], gameIds: [] }] }]);
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'exhibitionSync/source'), { revision: 1, obsoleteField: true });
    });
    const oldCommit = writeBatch(operator);
    oldCommit.delete(meeting);
    requestExhibitionRefresh(oldCommit);
    await assertFails(oldCommit.commit());
    expect((await getDoc(meeting)).exists()).toBe(true);

    await updateSessionGroupGames('isolated', 'group', ['new-game']);
    expect((await getDoc(meeting)).data()?.groups[0].gameIds).toEqual(['new-game']);
    await deleteSessionRecord('isolated');
    expect((await getDoc(meeting)).exists()).toBe(false);
    // The full scan repairs extra fields by replacing the marker and advances
    // even though the source edits never wrote to the exhibition collection.
    expect(await refreshExhibitions()).toBe(true);
    expect((await getDoc(marker)).data()).toMatchObject({ revision: 2, fingerprint: expect.any(String) });
  });

  it('publishes operating saves without the exhibition admin and supports a manual refresh', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedRegularAdmin();
    const operator = testEnv.authenticatedContext('watch-admin', { email: REGULAR_ADMIN_EMAIL }).firestore();
    sync.db = operator;
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'members/a'), { name: '자동 반영 부원' });
    });
    await saveExhibitionSettings('avalon', { enabled: true, period: { kind: 'all' }, gameMapping: [] });
    await refreshExhibitions();
    const access = doc(operator, 'exhibitionAccess/avalon');
    const initial = (await getDoc(access)).data()?.generationId;
    const marker = doc(operator, 'exhibitionSync/source');
    const errors = vi.fn();
    const stop = watchExhibitionSync(() => {}, errors, 'sources');
    try {
      await importSessionRecords([{ id: 'live', date: '2026-09-02', name: '실시간',
        groups: [{ id: 'group', memberIds: ['a'], gameIds: [] }] }]);
      await vi.waitFor(async () => {
        const updated = (await getDoc(access)).data()?.generationId;
        expect(updated).not.toBe(initial);
        const key = await exhibitionNameKey('자동 반영 부원');
        const path = `exhibitionAccess/avalon/generations/${updated}/names/${key}`;
        expect((await getDoc(doc(operator, path))).exists()).toBe(true);
      }, { timeout: 10_000, interval: 300 });
      expect((await getDoc(marker)).data()?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      await updateSessionGroupGames('live', 'group', ['new-game']);
      await vi.waitFor(async () => {
        expect((await loadExhibitionStatus('avalon')).unmappedGameIds).toEqual(['new-game']);
      }, { timeout: 10_000, interval: 300 });
      expect(errors).not.toHaveBeenCalledWith(expect.objectContaining({ code: expect.any(String) }));
    } finally { stop(); }

    const beforeRetry = (await getDoc(access)).data()?.generationId;
    await deleteSessionRecord('live');
    const stopAdmin = watchExhibitionSync(() => {}, errors, 'requests');
    try {
      await retryExhibitionRefresh();
      await vi.waitFor(async () => {
        expect((await getDoc(access)).data()?.generationId).not.toBe(beforeRetry);
        expect((await loadExhibitionStatus('avalon')).unmappedGameIds).toEqual([]);
        expect((await loadExhibitionStatus('avalon')).pending).toBe(false);
      }, { timeout: 10_000, interval: 300 });
    } finally { stopAdmin(); }
  }, 20_000);

  it('keeps a 400-record import atomic without writing to the exhibition', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedRegularAdmin();
    const operator = testEnv.authenticatedContext('import-admin', { email: REGULAR_ADMIN_EMAIL }).firestore();
    sync.db = operator;
    const records = Array.from({ length: 400 }, (_, index) => ({
      id: `import-${index}`, date: '2026-09-01', name: '합성', groups: [],
    }));
    await importSessionRecords(records);
    expect((await getDocs(collection(operator, 'sessions'))).size).toBe(400);
    const revision = doc(operator, 'exhibitionSync/source');
    expect((await getDoc(revision)).exists()).toBe(false);
    const extra = { ...records[0]!, id: 'not-written' };
    await expect(importSessionRecords([extra, records[0]!])).rejects.toThrow('이미 존재하는 세션 ID');
    expect((await getDoc(doc(operator, 'sessions/not-written'))).exists()).toBe(false);
    expect((await getDoc(revision)).exists()).toBe(false);
  }, 20_000);

  it('rejects malformed core records while allowing incremental legacy repairs', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedRegularAdmin();
    const db = testEnv.authenticatedContext('schema-admin', { email: REGULAR_ADMIN_EMAIL }).firestore();
    const member = { name: '새부원', nickname: '26 새부원', studentId: '26', phone: '', gender: '여', semester: '2026-2', preferredGenre: [], createdAt: serverTimestamp() };
    await assertFails(setDoc(doc(db, 'members', 'old-quick-add'), { name: '새부원', nickname: '25 새부원', studentId: '25', gender: '남', semester: '2025-1', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'members', 'bad-gender'), { ...member, gender: 'unknown' }));
    await assertSucceeds(setDoc(doc(db, 'members', 'valid'), member));
    await assertFails(updateDoc(doc(db, 'members', 'valid'), { status: 'unknown' }));
    await assertFails(updateDoc(doc(db, 'members', 'valid'), { preferredGenre: '전략' }));
    await assertFails(setDoc(doc(db, 'games', 'bad'), { title: '게임', minPlayers: '둘' }));
    await assertSucceeds(setDoc(doc(db, 'games', 'valid'), { title: '게임', minPlayers: 2, genres: [] }));
    await assertFails(setDoc(doc(db, 'sessions', 'bad'), { name: '모임', date: new Date(), groups: '잘못된 조' }));
    await assertSucceeds(setDoc(doc(db, 'sessions', 'valid'), { name: '모임', date: new Date(), groups: [], boardMemberIds: [] }));
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'members', 'legacy'), { name: '과거 부원' });
      await setDoc(doc(context.firestore(), 'sessions', 'legacy'), { name: '과거 모임', date: '2025-01-01', groups: [] });
    });
    await assertSucceeds(updateDoc(doc(db, 'members', 'legacy'), { status: '휴면' }));
    await assertSucceeds(updateDoc(doc(db, 'members', 'legacy'), { phone: '', preferredGenre: [] }));
    await assertSucceeds(updateDoc(doc(db, 'sessions', 'legacy'), { name: '수정한 모임' }));
    await assertFails(updateDoc(doc(db, 'sessions', 'legacy'), { groups: null }));
  });

  it('일반 관리자 → members 및 attendees 읽기 쓰기 허용, admins 쓰기 거부', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    // Setup regular admin (not master)
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'admins', 'regular@example.com'), { role: 'admin' });
      await setDoc(doc(db, 'members', 'm1'), { name: 'Member 1' });
      await setDoc(doc(db, 'games', 'g1'), { title: 'Game 1' });
      await setDoc(doc(db, 'sessions', 's1'), { name: 'Session 1' });
      await setDoc(doc(db, 'DailyPlannings', 'dp-read'), { date: '2026-08-22', groups: [], createdAt: new Date() });
    });

    const authedDb = testEnv.authenticatedContext('user-1', { email: 'regular@example.com' }).firestore();
    
    // members 읽기/쓰기 허용
    await assertSucceeds(getDoc(doc(authedDb, 'members', 'm1')));
    await assertSucceeds(setDoc(doc(authedDb, 'members', 'm2'), { name: 'Member 2', nickname: '26 Member 2', studentId: '26', phone: '', gender: '여', semester: '2026-2', preferredGenre: [], createdAt: serverTimestamp() }));
    await assertSucceeds(getDoc(doc(authedDb, 'games', 'g1')));
    await assertSucceeds(setDoc(doc(authedDb, 'games', 'g2'), { title: 'Game 2' }));
    await assertSucceeds(getDoc(doc(authedDb, 'sessions', 's1')));
    await assertSucceeds(setDoc(doc(authedDb, 'sessions', 's2'), { name: 'Session 2', date: new Date(), groups: [] }));
    await assertSucceeds(getDoc(doc(authedDb, 'DailyPlannings', 'dp-read')));

    // attendees 쓰기 쓰키마 검증
    await assertSucceeds(setDoc(doc(authedDb, 'attendees', 'a1'), { name: 'Att', importDate: serverTimestamp(), status: '대기' }));
    await assertSucceeds(updateDoc(doc(authedDb, 'attendees', 'a1'), { memberId: 'm1' }));
    await assertSucceeds(setDoc(doc(authedDb, 'attendees', 'unregistered'), { name: 'New', memberId: null, importDate: serverTimestamp(), status: '대기' }));
    await assertFails(setDoc(doc(authedDb, 'attendees', 'a2'), { name: 'Att2' })); // Missing status, importDate
    
    // admins 쓰기 거부 (마스터가 아니므로)
    await assertSucceeds(getDoc(doc(authedDb, 'admins', 'regular@example.com')));
    await assertFails(getDoc(doc(authedDb, 'admins', 'other@example.com')));
    await assertFails(setDoc(doc(authedDb, 'admins', 'newadmin@example.com'), {}));
  });

  it('former bootstrap email has no implicit privilege, including after registration as admin', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const db = testEnv.authenticatedContext('former-bootstrap', { email: FORMER_BOOTSTRAP_EMAIL }).firestore();
    await assertSucceeds(getDoc(doc(db, 'admins', FORMER_BOOTSTRAP_EMAIL)));
    await assertFails(getDocs(collection(db, 'members')));
    await assertFails(setDoc(doc(db, 'admins', FORMER_BOOTSTRAP_EMAIL), { role: 'master' }));
    await seedRegularAdmin(FORMER_BOOTSTRAP_EMAIL);
    await assertSucceeds(getDocs(collection(db, 'members')));
    await assertFails(getDocs(collection(db, 'admins')));
    await assertFails(setDoc(doc(db, 'admins', 'newuser@example.com'), { email: 'newuser@example.com', role: 'admin', createdAt: serverTimestamp() }));
  });

  it('DailyPlannings createdAt 정상 생성 성공 및 클라이언트 임의 시간 거부', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    // Setup regular admin
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'admins', 'regular@example.com'), { role: 'admin' });
    });

    const authedDb = testEnv.authenticatedContext('user-1', { email: 'regular@example.com' }).firestore();

    // 정상: serverTimestamp() 사용
    await assertSucceeds(
      setDoc(doc(authedDb, 'DailyPlannings', 'dp1'), {
        date: '2024-01-01',
        groups: [],
        createdAt: serverTimestamp()
      })
    );

    // 실패: 과거/미래 날짜 클라이언트 임의 삽입 불가
    await assertFails(
      setDoc(doc(authedDb, 'DailyPlannings', 'dp2'), {
        date: '2024-01-01',
        groups: [],
        createdAt: new Date('2020-01-01')
      })
    );
  });

  it('모임 이전 버전은 관리자만 보관·열람·삭제하고 기존 버전 변조는 거부한다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedRegularAdmin();
    const adminDb = testEnv.authenticatedContext('version-admin', { email: REGULAR_ADMIN_EMAIL }).firestore();
    const publicDb = testEnv.unauthenticatedContext().firestore();
    const userDb = testEnv.authenticatedContext('non-admin', { email: 'member@example.com' }).firestore();
    const path = ['DailyPlannings', '2026-09-10', 'versions', 'v1'] as const;
    const version = { snapshot: { name: '모임', date: '2026-09-10', groups: [] }, archivedAt: serverTimestamp(), actorEmail: REGULAR_ADMIN_EMAIL, reason: '모임 다시 시작 전' };
    await assertSucceeds(setDoc(doc(adminDb, ...path), version));
    await assertSucceeds(getDocs(collection(adminDb, 'DailyPlannings', '2026-09-10', 'versions')));
    await assertFails(getDoc(doc(publicDb, ...path)));
    await assertFails(getDocs(collection(userDb, 'DailyPlannings', '2026-09-10', 'versions')));
    await assertFails(updateDoc(doc(adminDb, ...path), { reason: '변조' }));
    await assertFails(setDoc(doc(adminDb, 'DailyPlannings', '2026-09-10', 'versions', 'forged'), { ...version, actorEmail: 'other@example.com' }));
    await assertFails(setDoc(doc(userDb, 'DailyPlannings', '2026-09-10', 'versions', 'unauthorized'), { ...version, actorEmail: 'member@example.com' }));
    await assertFails(deleteDoc(doc(publicDb, ...path)));
    await assertSucceeds(deleteDoc(doc(adminDb, ...path)));
  });

  it('저장된 master role 관리자도 admins 컬렉션을 관리할 수 있다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedMasterAdmin();
    const masterDb = testEnv.authenticatedContext('master-2', { email: MASTER_ADMIN_EMAIL }).firestore();
    await assertSucceeds(setDoc(doc(masterDb, 'admins', 'added@example.com'), {
      email: 'added@example.com', role: 'admin', createdAt: serverTimestamp(),
    }));
    await assertSucceeds(getDocs(collection(masterDb, 'admins')));
    await assertSucceeds(deleteDoc(doc(masterDb, 'admins', 'added@example.com')));
  });

  it('master cannot create, promote, demote, modify or delete any master through client requests', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedMasterAdmin();
    await seedMasterAdmin('second@example.com');
    await seedRegularAdmin();
    const db = testEnv.authenticatedContext('master', { email: MASTER_ADMIN_EMAIL }).firestore();
    await assertFails(setDoc(doc(db, 'admins', 'new-master@example.com'), {
      email: 'new-master@example.com', role: 'master', createdAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(db, 'admins', REGULAR_ADMIN_EMAIL), { role: 'master' }));
    await assertFails(updateDoc(doc(db, 'admins', REGULAR_ADMIN_EMAIL), { email: 'changed@example.com' }));
    for (const email of [MASTER_ADMIN_EMAIL, 'second@example.com']) {
      await assertFails(updateDoc(doc(db, 'admins', email), { role: 'admin' }));
      await assertFails(updateDoc(doc(db, 'admins', email), { extra: true }));
      await assertFails(setDoc(doc(db, 'admins', email), { email, role: 'admin', createdAt: serverTimestamp() }));
      await assertFails(deleteDoc(doc(db, 'admins', email)));
    }
    const batch = writeBatch(db);
    batch.set(doc(db, 'admins', 'atomic@example.com'), { email: 'atomic@example.com', role: 'admin', createdAt: serverTimestamp() });
    batch.delete(doc(db, 'admins', MASTER_ADMIN_EMAIL));
    await assertFails(batch.commit());
    const absent = await assertSucceeds(getDoc(doc(db, 'admins', 'atomic@example.com')));
    if (absent.exists()) throw new Error('Rejected batch must not create an administrator');
  });

  it('rejects malformed operator creation, including email IDs, extra fields and client timestamps', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedMasterAdmin();
    const db = testEnv.authenticatedContext('master', { email: MASTER_ADMIN_EMAIL }).firestore();
    const valid = { email: 'new@example.com', role: 'admin', createdAt: serverTimestamp() };
    for (const [email, data] of [
      ['new@example.com', {}],
      ['new@example.com', { ...valid, email: 'different@example.com' }],
      ['new@example.com', { ...valid, role: 'owner' }],
      ['new@example.com', { ...valid, createdAt: new Date('2020-01-01') }],
      ['new@example.com', { ...valid, createdAt: 'now' }],
      ['new@example.com', { ...valid, extra: true }],
      ['New@example.com', { ...valid, email: 'New@example.com' }],
      [' new@example.com ', { ...valid, email: ' new@example.com ' }],
      ['not-an-email', { ...valid, email: 'not-an-email' }],
      ['bad name@example.com', { ...valid, email: 'bad name@example.com' }],
    ] as const) {
      await assertFails(setDoc(doc(db, 'admins', email), data));
    }
  });

  it('only masters may write admins, and removing an admin blocks subsequent requests on the same session', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedMasterAdmin();
    await seedRegularAdmin();
    const regular = testEnv.authenticatedContext('operator', { email: REGULAR_ADMIN_EMAIL }).firestore();
    const outsider = testEnv.authenticatedContext('outsider', { email: 'outsider@example.com' }).firestore();
    for (const db of [regular, outsider, testEnv.unauthenticatedContext().firestore()]) {
      await assertFails(setDoc(doc(db, 'admins', 'new@example.com'), { email: 'new@example.com', role: 'admin', createdAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(db, 'admins', REGULAR_ADMIN_EMAIL), { role: 'master' }));
      await assertFails(deleteDoc(doc(db, 'admins', REGULAR_ADMIN_EMAIL)));
    }
    await assertSucceeds(getDocs(collection(regular, 'members')));
    const master = testEnv.authenticatedContext('master', { email: MASTER_ADMIN_EMAIL }).firestore();
    await assertSucceeds(deleteDoc(doc(master, 'admins', REGULAR_ADMIN_EMAIL)));
    await assertFails(getDocs(collection(regular, 'members')));
  });

  it('matches normalized email claims and refuses missing or unknown stored roles', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedMasterAdmin();
    const db = testEnv.authenticatedContext('mixed-case-master', { email: 'MASTER@EXAMPLE.COM' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'admins', MASTER_ADMIN_EMAIL)));
    await assertSucceeds(getDocs(collection(db, 'admins')));
    for (const role of [undefined, null, 'owner', '', 1]) {
      await testEnv.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'admins', 'invalid@example.com'), role === undefined ? {} : { role });
      });
      const invalid = testEnv.authenticatedContext('invalid-role', { email: 'invalid@example.com' }).firestore();
      await assertSucceeds(getDoc(doc(invalid, 'admins', 'invalid@example.com')));
      await assertFails(getDocs(collection(invalid, 'members')));
      await assertFails(getDocs(collection(invalid, 'admins')));
      await assertFails(deleteDoc(doc(db, 'admins', 'invalid@example.com')));
    }
  });

  it('operator creation and deletion still commit atomically with audit events', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedMasterAdmin();
    const db = testEnv.authenticatedContext('master', { email: MASTER_ADMIN_EMAIL }).firestore();
    const create = writeBatch(db);
    create.set(doc(db, 'admins', 'new@example.com'), { email: 'new@example.com', role: 'admin', createdAt: serverTimestamp() });
    const event = { category: 'admin', action: 'admin.added', actorEmail: MASTER_ADMIN_EMAIL,
      occurredAt: serverTimestamp(), targetLabel: 'new@example.com', schemaVersion: 1 };
    create.set(doc(db, 'auditEvents', 'added'), event);
    await assertSucceeds(create.commit());
    const remove = writeBatch(db);
    remove.delete(doc(db, 'admins', 'new@example.com'));
    remove.set(doc(db, 'auditEvents', 'removed'), { ...event, action: 'admin.removed' });
    await assertSucceeds(remove.commit());
  });

  it('변경 이력은 로그인 이메일과 서버 시각으로만 추가되고 마스터만 읽을 수 있다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedRegularAdmin();
    await seedMasterAdmin();
    const adminDb = testEnv.authenticatedContext('audit-admin', { email: REGULAR_ADMIN_EMAIL }).firestore();
    const masterDb = testEnv.authenticatedContext('audit-master', { email: MASTER_ADMIN_EMAIL }).firestore();
    const publicDb = testEnv.unauthenticatedContext().firestore();
    const eventRef = doc(adminDb, 'auditEvents', 'event-1');

    await assertSucceeds(setDoc(eventRef, {
      category: 'member',
      action: 'member.updated',
      actorEmail: REGULAR_ADMIN_EMAIL,
      occurredAt: serverTimestamp(),
      targetId: 'member-1',
      targetLabel: '홍길동',
      changes: [{ field: 'phone', label: '연락처', before: '없음', after: '010-0000-0000' }],
      schemaVersion: 1,
    }));

    await assertFails(getDoc(eventRef));
    await assertSucceeds(getDoc(doc(masterDb, 'auditEvents', 'event-1')));
    await assertFails(updateDoc(doc(masterDb, 'auditEvents', 'event-1'), { targetLabel: '변조' }));
    await assertFails(deleteDoc(doc(masterDb, 'auditEvents', 'event-1')));
    await assertFails(setDoc(doc(adminDb, 'auditEvents', 'forged-actor'), {
      category: 'member', action: 'member.updated', actorEmail: 'other@example.com',
      occurredAt: serverTimestamp(), targetLabel: '변조', schemaVersion: 1,
    }));
    await assertFails(setDoc(doc(adminDb, 'auditEvents', 'forged-time'), {
      category: 'member', action: 'member.updated', actorEmail: REGULAR_ADMIN_EMAIL,
      occurredAt: new Date('2020-01-01'), targetLabel: '변조', schemaVersion: 1,
    }));
    await assertFails(setDoc(doc(publicDb, 'auditEvents', 'public-event'), {
      category: 'member', action: 'member.updated', actorEmail: REGULAR_ADMIN_EMAIL,
      occurredAt: serverTimestamp(), targetLabel: '변조', schemaVersion: 1,
    }));
  });

  it('일반 관리자는 면접 비공개 데이터와 공개 컬렉션 전체를 관리할 수 있다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedRegularAdmin();
    const { roundId, token, applicantId } = await seedInterviewFixture();
    const adminDb = testEnv.authenticatedContext('admin-user', { email: REGULAR_ADMIN_EMAIL }).firestore();

    await assertSucceeds(getDoc(doc(adminDb, 'interviewRounds', roundId)));
    await assertSucceeds(updateDoc(doc(adminDb, 'interviewRounds', roundId), { status: 'closed' }));
    await assertSucceeds(getDoc(doc(adminDb, 'interviewApplicants', applicantId)));
    await assertSucceeds(updateDoc(doc(adminDb, 'interviewApplicants', applicantId), { phone: '01011112222' }));
    await assertSucceeds(updateDoc(doc(adminDb, 'interviewApplicants', applicantId), {
      'reminderMessage.firstMarkedSentAt': serverTimestamp(),
      'reminderMessage.lastMarkedSentAt': serverTimestamp(),
    }));
    await assertSucceeds(getDocs(collection(adminDb, 'interviewPublicRounds')));
    await assertSucceeds(getDocs(collection(adminDb, 'interviewAccess')));
    await assertSucceeds(getDocs(collection(adminDb, 'interviewChangeRequests')));
    await assertSucceeds(updateDoc(doc(adminDb, 'interviewAccess', token), { displayName: '관리자 수정' }));
    await assertSucceeds(setDoc(doc(adminDb, 'interviewAccess', 'admin-created-token'), { active: false }));
    await assertSucceeds(deleteDoc(doc(adminDb, 'interviewAccess', 'admin-created-token')));
    const lockRef = doc(adminDb, 'interviewAssignmentLocks', 'round__default__slot');
    await assertSucceeds(setDoc(lockRef, { roundId, applicantId, interviewerId: 'default' }));
    await assertSucceeds(getDoc(lockRef));
    await assertSucceeds(deleteDoc(lockRef));
    const applicantKeyRef = doc(adminDb, 'interviewApplicantKeys', `${roundId}__001`);
    await assertSucceeds(setDoc(applicantKeyRef, { roundId, applicantNumber: '001', applicantId }));
    await assertSucceeds(getDoc(applicantKeyRef));
    const profileRef = doc(adminDb, 'interviewerProfiles', 'profile-1');
    await assertSucceeds(setDoc(profileRef, { displayName: '면접관' }));
    await assertSucceeds(getDoc(profileRef));
    const interviewerRef = doc(adminDb, 'interviewRoundInterviewers', `${roundId}__profile-1`);
    await assertSucceeds(setDoc(interviewerRef, { roundId, interviewerId: 'profile-1', active: true }));
    await assertSucceeds(getDoc(interviewerRef));
    const assignmentEventRef = doc(adminDb, 'interviewAssignmentEvents', 'assignment-event-1');
    await assertSucceeds(setDoc(assignmentEventRef, { roundId, applicantId, type: 'assigned' }));
    await assertSucceeds(getDoc(assignmentEventRef));
    await assertFails(updateDoc(assignmentEventRef, { type: 'changed' }));
    await assertSucceeds(deleteDoc(assignmentEventRef));
    const noteRef = doc(adminDb, 'interviewNotes', `${roundId}__${applicantId}`);
    await assertSucceeds(setDoc(noteRef, {
      roundId,
      applicantId,
      interviewerId: 'default',
      interviewerName: '기본 면접관',
      generalNotes: '관리자 내부 기록',
      answers: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(noteRef));
    const recordEventRef = doc(adminDb, 'interviewRecordEvents', 'event-1');
    await assertSucceeds(setDoc(recordEventRef, { roundId, applicantId, type: 'completed' }));
    await assertSucceeds(getDoc(recordEventRef));
    await assertFails(updateDoc(recordEventRef, { type: 'rating_changed' }));
    await assertSucceeds(deleteDoc(recordEventRef));
    const changeRequestRef = doc(adminDb, 'interviewChangeRequests', token);
    await assertSucceeds(setDoc(changeRequestRef, { roundId, applicantId, status: 'open' }));
    await assertSucceeds(getDoc(changeRequestRef));
    await assertSucceeds(deleteDoc(changeRequestRef));
  });

  it('admins에 등록되지 않은 로그인 사용자는 내부 운영 데이터에 접근할 수 없다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const { roundId, applicantId } = await seedInterviewFixture();
    const userDb = testEnv.authenticatedContext('ordinary-user', { email: 'ordinary@example.com' }).firestore();

    await assertFails(getDocs(collection(userDb, 'members')));
    await assertFails(getDocs(collection(userDb, 'games')));
    await assertFails(getDocs(collection(userDb, 'sessions')));
    await assertFails(getDocs(collection(userDb, 'attendees')));
    await assertFails(getDocs(collection(userDb, 'DailyPlannings')));
    await assertFails(getDoc(doc(userDb, 'interviewApplicants', applicantId)));
    await assertFails(getDoc(doc(userDb, 'interviewNotes', `${roundId}__${applicantId}`)));
    await assertFails(setDoc(doc(userDb, 'interviewNotes', `${roundId}__${applicantId}`), { generalNotes: 'unauthorized' }));
    await assertFails(getDoc(doc(userDb, 'interviewRounds', roundId)));
    await assertFails(setDoc(doc(userDb, 'interviewRounds', 'new-round'), { name: 'unauthorized' }));
    await assertFails(getDocs(collection(userDb, 'interviewAccess')));
    await assertFails(getDocs(collection(userDb, 'interviewPublicRounds')));
    await assertFails(setDoc(doc(userDb, 'members', 'not-allowed'), { name: '쓰기 시도' }));
  });

  it('공개 사용자는 활성 public round와 token 문서를 정확한 경로로만 조회할 수 있다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const { roundId, token } = await seedInterviewFixture();
    await seedInterviewFixture({
      roundId: 'inactive-round',
      token: 'inactive-token',
      applicantId: 'inactive-applicant',
      roundActive: false,
      tokenActive: false,
    });
    const publicDb = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(publicDb, 'interviewPublicRounds', roundId)));
    await assertSucceeds(getDoc(doc(publicDb, 'interviewAccess', token)));
    await assertFails(getDoc(doc(publicDb, 'interviewNotes', `${roundId}__applicant-1`)));
    await assertFails(getDocs(collection(publicDb, 'interviewRecordEvents')));
    await assertSucceeds(getDoc(doc(publicDb, 'interviewAccess', 'missing-token')));
    await assertFails(getDoc(doc(publicDb, 'interviewPublicRounds', 'inactive-round')));
    await assertFails(getDoc(doc(publicDb, 'interviewAccess', 'inactive-token')));
    await assertFails(getDocs(collection(publicDb, 'interviewPublicRounds')));
    await assertFails(getDocs(collection(publicDb, 'interviewAccess')));
    await assertFails(
      getDocs(query(collection(publicDb, 'interviewAccess'), where('applicantId', '==', 'applicant-1')))
    );
  });

  it('일정에 지정된 공개 사용자는 자신의 public schedule만 읽고 그 슬롯에 응답할 수 있다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const { token, scheduleId } = await seedScheduledInterviewFixture();
    const publicDb = testEnv.unauthenticatedContext().firestore();
    const accessRef = doc(publicDb, 'interviewAccess', token);

    await assertSucceeds(getDoc(doc(publicDb, 'interviewPublicSchedules', scheduleId)));
    await assertFails(getDocs(collection(publicDb, 'interviewPublicSchedules')));
    await assertSucceeds(updateDoc(accessRef, {
      availability: [ALLOWED_SLOT_A],
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      responseUpdatedAt: serverTimestamp(),
    }));
  });

  it('공개 사용자는 token 문서를 생성하거나 삭제할 수 없다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const { token } = await seedInterviewFixture();
    const publicDb = testEnv.unauthenticatedContext().firestore();

    await assertFails(setDoc(doc(publicDb, 'interviewAccess', 'forged-token'), {
      active: true,
      roundId: 'round-1',
    }));
    await assertFails(deleteDoc(doc(publicDb, 'interviewAccess', token)));
    await assertFails(setDoc(doc(publicDb, 'interviewPublicRounds', 'forged-round'), { active: true }));
  });

  it('공개 사용자는 조사 기간 중 허용된 availability를 서버 시각으로 최초 제출하고 다시 수정할 수 있다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const { token } = await seedInterviewFixture();
    const publicDb = testEnv.unauthenticatedContext().firestore();
    const accessRef = doc(publicDb, 'interviewAccess', token);

    await assertSucceeds(updateDoc(accessRef, {
      availability: [ALLOWED_SLOT_A],
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      responseUpdatedAt: serverTimestamp(),
    }));

    const submittedSnapshot = await getDoc(accessRef);
    const submittedAt = submittedSnapshot.data()?.submittedAt;
    if (!submittedAt) throw new Error('submittedAt was not stored');

    await assertSucceeds(updateDoc(accessRef, {
      availability: [ALLOWED_SLOT_A, ALLOWED_SLOT_B],
      submittedAt,
      updatedAt: serverTimestamp(),
      responseUpdatedAt: serverTimestamp(),
    }));
  });

  it('공개 availability는 허용 slot의 중복 없는 부분집합이어야 한다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const { token } = await seedInterviewFixture();
    const publicDb = testEnv.unauthenticatedContext().firestore();
    const accessRef = doc(publicDb, 'interviewAccess', token);

    await assertFails(updateDoc(accessRef, {
      availability: [ALLOWED_SLOT_A, ALLOWED_SLOT_A],
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(accessRef, {
      availability: ['2026-08-25|23:30'],
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(accessRef, {
      availability: ALLOWED_SLOT_A,
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  it('Spark 호환 공개 availability는 회차의 허용 slot만 검증한다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const { token } = await seedInterviewFixture();
    const publicDb = testEnv.unauthenticatedContext().firestore();
    const accessRef = doc(publicDb, 'interviewAccess', token);

    await assertSucceeds(updateDoc(accessRef, {
      availability: [ALLOWED_SLOT_A],
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      responseUpdatedAt: serverTimestamp(),
    }));
    const submittedAt = (await getDoc(accessRef)).data()?.submittedAt;
    await assertSucceeds(updateDoc(accessRef, {
      availability: [ALLOWED_SLOT_B],
      submittedAt,
      updatedAt: serverTimestamp(),
      responseUpdatedAt: serverTimestamp(),
    }));
  });

  it('공개 사용자는 최초 접속 시각을 Firestore 서버 시각으로 한 번만 기록할 수 있다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const { token } = await seedInterviewFixture();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'interviewAccess', token), { firstAccessedAt: null });
    });
    const publicDb = testEnv.unauthenticatedContext().firestore();
    const accessRef = doc(publicDb, 'interviewAccess', token);

    await assertSucceeds(updateDoc(accessRef, { firstAccessedAt: serverTimestamp() }));
    await assertFails(updateDoc(accessRef, { firstAccessedAt: serverTimestamp() }));
    await assertFails(updateDoc(accessRef, { firstAccessedAt: new Date('2020-01-01T00:00:00Z') }));
  });

  it('공개 응답은 submittedAt과 updatedAt에 클라이언트 임의 시각을 사용할 수 없다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const { token } = await seedInterviewFixture();
    const publicDb = testEnv.unauthenticatedContext().firestore();
    const accessRef = doc(publicDb, 'interviewAccess', token);

    await assertFails(updateDoc(accessRef, {
      availability: [ALLOWED_SLOT_A],
      submittedAt: new Date('2020-01-01T00:00:00Z'),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(accessRef, {
      availability: [ALLOWED_SLOT_A],
      submittedAt: serverTimestamp(),
      updatedAt: new Date('2020-01-01T00:00:00Z'),
    }));
    await assertFails(updateDoc(accessRef, {
      availability: [ALLOWED_SLOT_A],
      submittedAt: null,
      updatedAt: serverTimestamp(),
    }));

    await assertSucceeds(updateDoc(accessRef, {
      availability: [ALLOWED_SLOT_A],
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      responseUpdatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(accessRef, {
      availability: [ALLOWED_SLOT_B],
      submittedAt: new Date('2020-01-01T00:00:00Z'),
      updatedAt: serverTimestamp(),
    }));
  });

  it('공개 사용자는 token의 식별자와 관리자 전용 필드를 바꿀 수 없다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const { token } = await seedInterviewFixture();
    const publicDb = testEnv.unauthenticatedContext().firestore();
    const accessRef = doc(publicDb, 'interviewAccess', token);
    const validResponse = {
      availability: [ALLOWED_SLOT_A],
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      responseUpdatedAt: serverTimestamp(),
    };

    await assertFails(updateDoc(accessRef, { ...validResponse, roundId: 'other-round' }));
    await assertFails(updateDoc(accessRef, { ...validResponse, applicantId: 'other-applicant' }));
    await assertFails(updateDoc(accessRef, { ...validResponse, displayName: '변조된 이름' }));
    await assertFails(updateDoc(accessRef, { ...validResponse, active: false }));
    await assertFails(updateDoc(accessRef, { ...validResponse, assignment: { startsAt: new Date() } }));
    await assertFails(updateDoc(accessRef, { ...validResponse, phone: '01099999999' }));
  });

  it('공개 응답은 상태값이 아니라 조사 시작·마감 시각으로만 허용한다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const now = Date.now();
    await seedInterviewFixture({
      roundId: 'future-round',
      token: 'future-token',
      applicantId: 'future-applicant',
      surveyOpensAt: new Date(now + 60 * 60 * 1000),
      surveyClosesAt: new Date(now + 2 * 60 * 60 * 1000),
    });
    await seedInterviewFixture({
      roundId: 'past-round',
      token: 'past-token',
      applicantId: 'past-applicant',
      surveyOpensAt: new Date(now - 2 * 60 * 60 * 1000),
      surveyClosesAt: new Date(now - 60 * 60 * 1000),
    });
    await seedInterviewFixture({
      roundId: 'legacy-draft-round',
      token: 'legacy-draft-token',
      applicantId: 'legacy-draft-applicant',
      status: 'draft',
    });
    const publicDb = testEnv.unauthenticatedContext().firestore();

    for (const token of ['future-token', 'past-token']) {
      await assertFails(updateDoc(doc(publicDb, 'interviewAccess', token), {
        availability: [ALLOWED_SLOT_A],
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        responseUpdatedAt: serverTimestamp(),
      }));
    }

    // 기존 초안 상태 문서도 조사 기간 안이면 응답할 수 있다.
    await assertSucceeds(updateDoc(doc(publicDb, 'interviewAccess', 'legacy-draft-token'), {
      availability: [ALLOWED_SLOT_A],
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      responseUpdatedAt: serverTimestamp(),
    }));

    // 기간 밖에도 활성 token의 기존 응답 조회는 가능하지만 수정만 차단한다.
    await assertSucceeds(getDoc(doc(publicDb, 'interviewAccess', 'past-token')));
  });

  it('비활성 round 또는 비활성 token으로는 공개 응답을 수정할 수 없다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    await seedInterviewFixture({
      roundId: 'inactive-public-round',
      token: 'round-inactive-token',
      applicantId: 'round-inactive-applicant',
      roundActive: false,
    });
    await seedInterviewFixture({
      roundId: 'active-round',
      token: 'token-inactive',
      applicantId: 'token-inactive-applicant',
      tokenActive: false,
    });
    const publicDb = testEnv.unauthenticatedContext().firestore();

    for (const token of ['round-inactive-token', 'token-inactive']) {
      await assertFails(updateDoc(doc(publicDb, 'interviewAccess', token), {
        availability: [ALLOWED_SLOT_A],
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
    }
  });

  it('공개 사용자는 일정 변경 요청을 만들거나 access 상태를 바꿀 수 없다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const { token, roundId, applicantId } = await seedInterviewFixture();
    const publicDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(publicDb, 'interviewChangeRequests', token), {
      roundId,
      applicantId,
      applicantName: '지원자',
      status: 'open',
      reason: '다른 시간 요청',
      requestedAt: serverTimestamp(),
      resolvedAt: null,
      resolvedBy: null,
    }));
    await assertFails(updateDoc(doc(publicDb, 'interviewAccess', token), { changeRequestStatus: 'open' }));
    await assertFails(updateDoc(doc(publicDb, 'interviewAccess', token), { assignmentSummary: null }));
  });
  it('면접 완료 후에는 공개 링크로 응답을 수정할 수 없다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const { token } = await seedInterviewFixture();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'interviewAccess', token), {
        assignmentSummary: { slotId: ALLOWED_SLOT_A, status: 'completed', revision: 1 },
      });
    });
    const publicDb = testEnv.unauthenticatedContext().firestore();

    await assertFails(updateDoc(doc(publicDb, 'interviewAccess', token), {
      availability: [ALLOWED_SLOT_A],
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      responseUpdatedAt: serverTimestamp(),
    }));
  });

  it('면접관 이름이 포함된 공개 배정 정보는 지원자 링크에서 읽을 수 없다', async () => {
    if (!testEnv) throw new Error('testEnv not initialized');
    const { token } = await seedInterviewFixture();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'interviewAccess', token), {
        assignmentSummary: {
          slotId: ALLOWED_SLOT_A,
          status: 'confirmed',
          revision: 1,
          interviewerName: '노출되면 안 되는 이름',
        },
      });
    });

    const publicDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(publicDb, 'interviewAccess', token)));
  });

});

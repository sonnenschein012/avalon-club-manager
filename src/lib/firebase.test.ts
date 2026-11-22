import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkAdminStatus } from './firebase';

const mocks = vi.hoisted(() => ({ read: vi.fn(), doc: vi.fn() }));
vi.mock('firebase/app', () => ({ initializeApp: vi.fn() }));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({}), GoogleAuthProvider: class {}, connectAuthEmulator: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(), signOut: vi.fn(), updateProfile: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}), doc: mocks.doc, getDocFromServer: mocks.read, connectFirestoreEmulator: vi.fn(),
}));

describe('database-backed administrator access', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['ordinary@example.com', 'eunchangyang1@gmail.com'])('requires a server document for %s', async email => {
    mocks.read.mockResolvedValue({ exists: () => false });
    expect(await checkAdminStatus(email)).toEqual({ isAdmin: false, isMaster: false });
  });

  it.each([
    ['admin', true, false], ['master', true, true], ['owner', false, false],
    [undefined, false, false], [null, false, false], [1, false, false],
  ])('uses stored role %s without exceptions', async (role, isAdmin, isMaster) => {
    mocks.read.mockResolvedValue({ exists: () => true, data: () => ({ role }) });
    expect(await checkAdminStatus('eunchangyang1@gmail.com')).toEqual({ isAdmin, isMaster });
  });

  it('normalizes the email and fails closed when the server lookup fails', async () => {
    mocks.read.mockRejectedValue(new Error('offline or permission denied'));
    expect(await checkAdminStatus('  MASTER@EXAMPLE.COM  ')).toEqual({ isAdmin: false, isMaster: false });
    expect(mocks.doc).toHaveBeenCalledWith(expect.anything(), 'admins', 'master@example.com');
  });
});

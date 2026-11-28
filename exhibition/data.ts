import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import firebaseConfig from '@firebase-config';
import { createExhibitionReader, ExhibitionUnavailable } from './reader';
import { createPublicSessionsLoader } from './publicSessions';
export { exhibitionLookupBudget } from './reader';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
if (import.meta.env.DEV && import.meta.env.MODE === 'development') {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

const exhibitionId = import.meta.env.VITE_EXHIBITION_ID || 'avalon';
const loadPublicSessions = import.meta.env.DEV && import.meta.env.MODE === 'development'
  ? undefined : createPublicSessionsLoader(firebaseConfig, exhibitionId);
export const {
  primeExhibitionNameLookup, findExhibitionMembers, loadExhibitionView, loadExhibitionPinImage, watchExhibitionPublication,
  watchExhibitionCopy, watchExhibitionAppearance,
} = createExhibitionReader(db, exhibitionId, loadPublicSessions);

export function exhibitionErrorMessage(error: unknown, copy: { unpublished: string; loadError: string }) {
  return error instanceof ExhibitionUnavailable ? copy.unpublished : copy.loadError;
}

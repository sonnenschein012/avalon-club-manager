import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import firebaseConfig from '@firebase-config';
import { createExhibitionReader, ExhibitionUnavailable } from './reader';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
if (import.meta.env.DEV && import.meta.env.MODE === 'development') {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

const exhibitionId = import.meta.env.VITE_EXHIBITION_ID || 'avalon';
export const {
  findExhibitionMembers, loadExhibitionView, loadExhibitionDescriptions, watchExhibitionPublication,
  watchExhibitionCopy, watchExhibitionAppearance,
} = createExhibitionReader(db, exhibitionId);

export function exhibitionErrorMessage(error: unknown) {
  return error instanceof ExhibitionUnavailable ? error.message : '기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

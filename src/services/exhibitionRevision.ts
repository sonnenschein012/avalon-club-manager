import { doc, increment, type DocumentReference, type FieldValue, type SetOptions } from 'firebase/firestore';
import { db } from '../lib/firebase';

export function exhibitionRevisionRef() {
  return doc(db, 'exhibitionSync', 'source');
}

/** Request a rebuild from the exhibition administrator only. */
export function requestExhibitionRefresh(writer: { set(ref: DocumentReference, data: { revision: FieldValue }, options: SetOptions): void }) {
  writer.set(exhibitionRevisionRef(), { revision: increment(1) }, { merge: true });
}

import { doc, increment, type DocumentReference, type FieldValue, type SetOptions } from 'firebase/firestore';
import { db } from '../lib/firebase';

export function exhibitionRevisionRef() {
  return doc(db, 'exhibitionSync', 'source');
}

/** Record an exhibition invalidation in the same commit as the source change. */
export function requestExhibitionRefresh(writer: { set(ref: DocumentReference, data: { revision: FieldValue }, options: SetOptions): void }) {
  writer.set(exhibitionRevisionRef(), { revision: increment(1) }, { merge: true });
}

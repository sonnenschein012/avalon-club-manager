import { doc, type Transaction } from 'firebase/firestore';
import { db } from '../lib/firebase';

export function sessionAuditSequenceRef() {
  return doc(db, 'auditSequences', 'sessions');
}

export function sessionAuditEventId(sequence: number) {
  return `session-${sequence}`;
}

/** Read before the transaction's first write. The returned writer advances it only if an event is recorded. */
export async function reserveSessionAuditSequence(transaction: Transaction) {
  const ref = sessionAuditSequenceRef();
  const sequence = Number((await transaction.get(ref)).data()?.sequence ?? 0) + 1;
  return () => {
    transaction.set(ref, { sequence, eventId: sessionAuditEventId(sequence) });
    return sequence;
  };
}

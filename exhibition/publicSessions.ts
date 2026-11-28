import type { PublicExhibitionSession } from '../src/domain/exhibition/collection';

type Value = { stringValue: string } | { arrayValue: { values?: Value[] } } | { mapValue: { fields?: Fields } };
type Fields = Record<string, Value>;
type Result = { found?: { name: string; fields: Fields }; missing?: string };

function array(value: Value | undefined) {
  if (!value || !('arrayValue' in value)) throw new Error('Invalid exhibition session array');
  return value.arrayValue.values ?? [];
}

function fields(value: Value) {
  if (!('mapValue' in value)) throw new Error('Invalid exhibition session map');
  return value.mapValue.fields ?? {};
}

function string(value: Value | undefined) {
  if (!value || !('stringValue' in value)) throw new Error('Invalid exhibition session text');
  return value.stringValue;
}

export function createPublicSessionsLoader(config: { projectId: string; firestoreDatabaseId: string; apiKey: string },
  exhibitionId: string) {
  const base = `projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents`;
  const url = new URL(`https://firestore.googleapis.com/v1/${base}:batchGet`);
  url.searchParams.set('key', config.apiKey);
  return async (generation: string, ids: readonly string[], signal: AbortSignal): Promise<PublicExhibitionSession[] | null> => {
    if (!ids.length) return [];
    const documents = ids.map(id => `${base}/exhibitionAccess/${exhibitionId}/generations/${generation}/sessions/${id}`);
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documents }), signal,
    });
    if (response.status === 403) throw Object.assign(new Error('Exhibition session access denied'), { code: 'permission-denied' });
    if (!response.ok) throw new Error(`Exhibition session read failed (${response.status})`);
    const rows = await response.json() as Result[];
    const found = new Map(rows.flatMap(row => row.found ? [[row.found.name, row.found.fields] as const] : []));
    if (documents.some(name => !found.has(name))) return null;
    return documents.map(name => {
      const session = found.get(name)!;
      return {
        date: string(session.date),
        groups: array(session.groups).map(fields).map(group => ({
          participants: array(group.participants).map(fields).map(member => ({
            profileId: string(member.profileId), name: string(member.name),
          })),
          gameIds: array(group.gameIds).map(string),
        })),
      };
    });
  };
}

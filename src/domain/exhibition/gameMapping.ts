import catalog from '../../../exhibition/games.json';

export interface ExhibitionGameChoice {
  id: string;
  title: string;
}

const normalize = (title: string) => title.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
const pinsByTitle = new Map<string, string | null>();
for (const [id, pin] of Object.entries(catalog)) {
  const title = normalize(pin.ko);
  pinsByTitle.set(title, pinsByTitle.has(title) ? null : id);
}

export function automaticExhibitionPins(games: readonly ExhibitionGameChoice[]) {
  const counts = new Map<string, number>();
  for (const game of games) {
    const title = normalize(game.title);
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  const suggestions = new Map<string, string>();
  for (const game of games) {
    const title = normalize(game.title);
    const pin = pinsByTitle.get(title);
    if (pin && counts.get(title) === 1) suggestions.set(game.id, pin);
  }
  return suggestions;
}

export function resolveExhibitionPins(
  automatic: ReadonlyMap<string, string>,
  overrides: readonly { sourceId: string; pinId: string }[],
) {
  const mapping = new Map(automatic);
  for (const { sourceId, pinId } of overrides) {
    if (pinId && Object.hasOwn(catalog, pinId)) mapping.set(sourceId, pinId);
    else mapping.delete(sourceId);
  }
  return mapping;
}
